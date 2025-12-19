import React, { useCallback, useEffect, useMemo, useState } from 'react';

export default function ViewStock({ supabaseClient }) {
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Adjustment UI (row-level)
  const [openAdjustFor, setOpenAdjustFor] = useState(null); // bundle_id
  const [type, setType] = useState('adjustment_out');
  const [packs, setPacks] = useState('');
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Movements
  const [movements, setMovements] = useState([]);
  const [movementFilterBundleId, setMovementFilterBundleId] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setMessage('');

    try {
      // 1) Load from the VIEW (no nested relationship calls here)
      // Your view already exposes bundle_id, name, packs_in_stock
      const { data: cs, error: csErr } = await supabaseClient
        .schema('app')
        .from('v_current_stock')
        .select('bundle_id,name,packs_in_stock')
        .order('name');

      if (csErr) throw csErr;

      const stock = cs || [];
      const bundleIds = [...new Set(stock.map((x) => x.bundle_id).filter(Boolean))];

      // 2) Load packs_per_bundle from bundles table
      let bundles = [];
      if (bundleIds.length > 0) {
        const { data: b, error: bErr } = await supabaseClient
          .schema('app')
          .from('bundles')
          .select('id,packs_per_bundle')
          .in('id', bundleIds);

        if (bErr) throw bErr;
        bundles = b || [];
      }

      const packsPerBundleById = new Map(bundles.map((b) => [b.id, Number(b.packs_per_bundle || 0)]));

      // 3) Merge into the shape your UI expects
      const normalized = stock.map((r) => ({
        bundle_id: r.bundle_id,
        name: r.name,
        packs_in_stock: Number(r.packs_in_stock || 0),
        packs_per_bundle: packsPerBundleById.get(r.bundle_id) || 0,
      }));

      setRows(normalized);
    } catch (error) {
      setMessage(error?.message || 'Failed to load stock.');
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [supabaseClient]);

  const loadMovements = useCallback(async () => {
    // Show last 50 movements
    let q = supabaseClient
      .schema('app')
      .from('stock_movements')
      .select('id,movement_type,movement_datetime,bundle_id,packs_delta,reason,bundles(name)')
      .order('movement_datetime', { ascending: false })
      .limit(50);

    if (movementFilterBundleId) q = q.eq('bundle_id', movementFilterBundleId);

    const { data, error } = await q;
    if (!error) setMovements(data || []);
  }, [supabaseClient, movementFilterBundleId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadMovements();
  }, [loadMovements]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.name || '').toLowerCase().includes(q));
  }, [rows, search]);

  const currentRow = useMemo(() => rows.find((r) => r.bundle_id === openAdjustFor) || null, [rows, openAdjustFor]);

  const qty = parseInt(packs || '0', 10);
  const delta = type === 'adjustment_in' ? qty : -qty;
  const resulting = currentRow ? currentRow.packs_in_stock + (Number.isFinite(delta) ? delta : 0) : null;

  const submitAdjustment = async (e) => {
    e.preventDefault();
    setMessage('');
    if (!openAdjustFor) return setMessage('Select a bundle to adjust.');
    if (!qty || qty <= 0) return setMessage('Enter packs > 0.');

    if (type === 'adjustment_out' && !reason.trim()) {
      return setMessage('Reason is required when removing stock.');
    }

    setIsSaving(true);

    const { error } = await supabaseClient.schema('app').from('stock_movements').insert([
      {
        movement_type: type,
        movement_datetime: new Date().toISOString(),
        bundle_id: openAdjustFor,
        packs_delta: delta,
        reason: reason.trim() ? reason.trim() : null,
      },
    ]);

    setIsSaving(false);

    if (error) {
      setMessage(`Error: ${error.message}`);
      return;
    }

    setMessage('✅ Stock adjustment saved.');
    setPacks('');
    setReason('');
    await load();
    await loadMovements();
  };

  const badgeFor = (packsInStock) => {
    if (packsInStock <= 0) return { text: 'OUT', color: '#ef4444' };
    if (packsInStock <= 10) return { text: 'LOW', color: '#f59e0b' };
    return null;
  };

  return (
    <div className="card">
      <h2>📦 Current Stock (Packs)</h2>

      {message && <p className={`message ${message.startsWith('Error') ? 'error' : ''}`}>{message}</p>}

      <div className="form-grid" style={{ marginBottom: 12 }}>
        <div className="form-group">
          <label>Search bundle</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type to search..." />
        </div>

        <div className="form-actions">
          <button type="button" className="button secondary" onClick={load} disabled={isLoading || isSaving}>
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="responsive-table">
        <table className="moderntable">
          <thead>
            <tr>
              <th>Bundle</th>
              <th>Packs/Bundle</th>
              <th>Packs in Stock</th>
              <th>Equivalent Bundles</th>
              <th>Status</th>
              <th style={{ width: 140 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan="6">No stock rows found.</td>
              </tr>
            ) : (
              filteredRows.map((r) => {
                const badge = badgeFor(r.packs_in_stock);
                const eqBundles = r.packs_per_bundle > 0 ? r.packs_in_stock / r.packs_per_bundle : null;

                return (
                  <React.Fragment key={r.bundle_id}>
                    <tr>
                      <td>
                        <strong>{r.name}</strong>
                      </td>
                      <td>{r.packs_per_bundle || '—'}</td>
                      <td>{r.packs_in_stock}</td>
                      <td>{eqBundles == null ? '—' : eqBundles.toFixed(2)}</td>
                      <td>
                        {badge ? (
                          <span style={{ padding: '2px 8px', borderRadius: 10, background: badge.color, color: 'white', fontWeight: 700 }}>
                            {badge.text}
                          </span>
                        ) : (
                          <span style={{ color: '#10b981', fontWeight: 700 }}>OK</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button primary"
                          onClick={() => {
                            setOpenAdjustFor((cur) => (cur === r.bundle_id ? null : r.bundle_id));
                            setType('adjustment_out');
                            setPacks('');
                            setReason('');
                            setMovementFilterBundleId(r.bundle_id);
                          }}
                        >
                          Adjust
                        </button>
                      </td>
                    </tr>

                    {openAdjustFor === r.bundle_id && (
                      <tr>
                        <td colSpan="6">
                          <div style={{ background: '#f9fafb', padding: 12, borderRadius: 12, border: '1px solid #e2e8f0' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                              <div>
                                <strong>Adjust:</strong> {r.name}
                                <div style={{ color: '#64748b', marginTop: 4 }}>
                                  Current: <strong>{r.packs_in_stock}</strong> packs
                                </div>
                              </div>
                              <button type="button" className="button secondary" onClick={() => setOpenAdjustFor(null)} disabled={isSaving}>
                                Close
                              </button>
                            </div>

                            <form onSubmit={submitAdjustment} className="form-grid" style={{ marginTop: 12 }}>
                              <div className="form-group">
                                <label>Type</label>
                                <select value={type} onChange={(e) => setType(e.target.value)} disabled={isSaving}>
                                  <option value="adjustment_out">Remove (damaged/lost/expired)</option>
                                  <option value="adjustment_in">Add (correction)</option>
                                </select>
                              </div>

                              <div className="form-group">
                                <label>Packs</label>
                                <input type="number" min="1" value={packs} onChange={(e) => setPacks(e.target.value)} disabled={isSaving} required />
                              </div>

                              <div className="form-group">
                                <label>Reason {type === 'adjustment_out' ? '(required)' : '(optional)'}</label>
                                <input
                                  value={reason}
                                  onChange={(e) => setReason(e.target.value)}
                                  disabled={isSaving}
                                  placeholder={type === 'adjustment_out' ? 'Required for removals' : 'Optional'}
                                />
                              </div>

                              <div className="metric-card" style={{ textAlign: 'left' }}>
                                <strong>Preview</strong>
                                <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                                  <div>
                                    Delta: <strong>{Number.isFinite(delta) ? delta : 0}</strong> packs
                                  </div>
                                  <div>
                                    Resulting Stock:{' '}
                                    <strong style={{ color: resulting != null && resulting < 0 ? '#ef4444' : 'inherit' }}>
                                      {resulting == null ? '—' : resulting}
                                    </strong>
                                  </div>
                                  {resulting != null && resulting < 0 && (
                                    <small style={{ color: '#ef4444' }}>Warning: this would go negative (DB may block this).</small>
                                  )}
                                </div>
                              </div>

                              <div className="form-actions">
                                <button className="button primary" type="submit" disabled={isSaving}>
                                  {isSaving ? 'Saving...' : 'Save Adjustment'}
                                </button>
                              </div>
                            </form>

                            <div style={{ marginTop: 16 }}>
                              <h4 style={{ margin: 0, color: '#3b82f6' }}>Recent Movements (filtered)</h4>
                              <div className="responsive-table">
                                <table className="moderntable" style={{ marginTop: 8 }}>
                                  <thead>
                                    <tr>
                                      <th>Date/Time</th>
                                      <th>Type</th>
                                      <th>Delta</th>
                                      <th>Reason</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {movements.length === 0 ? (
                                      <tr>
                                        <td colSpan="4">No movements found.</td>
                                      </tr>
                                    ) : (
                                      movements.map((m) => (
                                        <tr key={m.id}>
                                          <td>{new Date(m.movement_datetime).toLocaleString('en-LK', { timeZone: 'Asia/Colombo' })}</td>
                                          <td>{m.movement_type}</td>
                                          <td>{m.packs_delta}</td>
                                          <td>{m.reason || '—'}</td>
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <hr />

      <div className="form-grid" style={{ marginTop: 12 }}>
        <div className="form-group">
          <label>Movement history filter</label>
          <select value={movementFilterBundleId} onChange={(e) => setMovementFilterBundleId(e.target.value)}>
            <option value="">All bundles</option>
            {rows.map((r) => (
              <option key={r.bundle_id} value={r.bundle_id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-actions">
          <button type="button" className="button secondary" onClick={loadMovements}>
            Refresh Movements
          </button>
        </div>
      </div>

      {!openAdjustFor && (
        <div style={{ marginTop: 12 }}>
          <h3>📜 Recent Stock Movements</h3>
          <div className="responsive-table">
            <table className="moderntable">
              <thead>
                <tr>
                  <th>Date/Time</th>
                  <th>Bundle</th>
                  <th>Type</th>
                  <th>Delta</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {movements.length === 0 ? (
                  <tr>
                    <td colSpan="5">No movements found.</td>
                  </tr>
                ) : (
                  movements.map((m) => (
                    <tr key={m.id}>
                      <td>{new Date(m.movement_datetime).toLocaleString('en-LK', { timeZone: 'Asia/Colombo' })}</td>
                      <td>{m.bundles?.name || '—'}</td>
                      <td>{m.movement_type}</td>
                      <td>{m.packs_delta}</td>
                      <td>{m.reason || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
