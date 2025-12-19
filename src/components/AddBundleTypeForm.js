import React, { useCallback, useEffect, useMemo, useState } from 'react';

export default function AddBundleTypeForm({ supabaseClient }) {
  // Add form
  const [name, setName] = useState('');
  const [packsPerBundle, setPacksPerBundle] = useState('');
  const [expectedSellPerBundle, setExpectedSellPerBundle] = useState('');
  const [sku, setSku] = useState('');
  const [message, setMessage] = useState('');

  // Existing bundles
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  // Edit bundle fields (per row)
  const [edit, setEdit] = useState({}); // { [bundleId]: { expected_selling_price_per_bundle, sku, is_active } }

  // Suppliers + supplier-specific default costs
  const [suppliers, setSuppliers] = useState([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [supplierCosts, setSupplierCosts] = useState([]); // rows from supplier_bundle_costs for selected supplier

  // Edit buying prices (per bundle for selected supplier)
  const [buyEdit, setBuyEdit] = useState({}); // { [bundleId]: "123.45" }
  const [savingBuy, setSavingBuy] = useState(false);

  const supplierNameById = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);

  const loadSuppliers = useCallback(async () => {
    const { data, error } = await supabaseClient
      .schema('app')
      .from('suppliers')
      .select('id,name,is_active')
      .eq('is_active', true)
      .order('name');

    if (error) {
      setSuppliers([]);
      return;
    }
    setSuppliers(data || []);
  }, [supabaseClient]);

  const loadBundles = useCallback(async () => {
    setLoading(true);
    setMessage('');

    const { data, error } = await supabaseClient
      .schema('app')
      .from('bundles')
      .select('id,name,packs_per_bundle,expected_selling_price_per_bundle,sku,is_active,created_at')
      .order('name');

    if (error) {
      setMessage(`Error loading bundle types: ${error.message}`);
      setRows([]);
      setLoading(false);
      return;
    }

    setRows(data || []);

    // refresh edit cache for bundle-level fields
    const nextEdit = {};
    for (const r of data || []) {
      nextEdit[r.id] = {
        expected_selling_price_per_bundle: String(r.expected_selling_price_per_bundle ?? ''),
        sku: r.sku ?? '',
        is_active: r.is_active ?? true,
      };
    }
    setEdit(nextEdit);

    setLoading(false);
  }, [supabaseClient]);

  const loadSupplierCosts = useCallback(
    async (supplierId) => {
      if (!supplierId) {
        setSupplierCosts([]);
        setBuyEdit({});
        return;
      }

      const { data, error } = await supabaseClient
        .schema('app')
        .from('supplier_bundle_costs')
        .select('supplier_id,bundle_id,default_cost_per_bundle,updated_at')
        .eq('supplier_id', supplierId);

      if (error) {
        setSupplierCosts([]);
        setBuyEdit({});
        return;
      }

      const list = data || [];
      setSupplierCosts(list);

      // Map bundleId -> default cost for editing
      const m = {};
      for (const r of list) {
        m[r.bundle_id] = String(r.default_cost_per_bundle ?? '');
      }

      // Ensure all bundle IDs exist in buyEdit (empty allowed)
      const merged = {};
      for (const b of rows) {
        merged[b.id] = m[b.id] ?? '';
      }
      setBuyEdit(merged);
    },
    [supabaseClient, rows]
  );

  // Initial load
  useEffect(() => {
    (async () => {
      await loadSuppliers();
      await loadBundles();
    })();
  }, [loadSuppliers, loadBundles]);

  // Reload supplier costs when supplier changes OR when bundles list changes
  useEffect(() => {
    (async () => {
      if (selectedSupplierId) {
        await loadSupplierCosts(selectedSupplierId);
      }
    })();
  }, [selectedSupplierId, loadSupplierCosts]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setMessage('');

    const cleanName = name.trim();
    if (!cleanName) return setMessage('Bundle name is required.');

    const ppb = parseInt(packsPerBundle, 10);
    if (!ppb || ppb <= 0) return setMessage('Packs per bundle must be > 0.');

    const expected = parseFloat(expectedSellPerBundle);
    if (!(expected >= 0)) return setMessage('Expected selling price per bundle must be >= 0.');

    const { error } = await supabaseClient.schema('app').from('bundles').insert([
      {
        name: cleanName,
        packs_per_bundle: ppb,
        expected_selling_price_per_bundle: expected,
        sku: sku.trim() ? sku.trim() : null,
        is_active: true,
        // NOTE: default_supplier_cost_per_bundle is obsolete by your decision; do not write to it.
      },
    ]);

    if (error) {
      if ((error.message || '').toLowerCase().includes('duplicate')) {
        return setMessage('Error: Bundle name already exists.');
      }
      return setMessage(`Error: ${error.message}`);
    }

    setMessage('✅ Bundle type added successfully!');
    setName('');
    setPacksPerBundle('');
    setExpectedSellPerBundle('');
    setSku('');

    await loadBundles();

    // Refresh supplier costs editor if a supplier is selected
    if (selectedSupplierId) {
      await loadSupplierCosts(selectedSupplierId);
    }
  };

  const updateEdit = (bundleId, field, value) => {
    setEdit((prev) => ({
      ...prev,
      [bundleId]: {
        ...(prev[bundleId] || {}),
        [field]: value,
      },
    }));
  };

  const saveBundleEdit = async (bundleId) => {
    setMessage('');
    const rowEdit = edit[bundleId];
    if (!rowEdit) return;

    const expected = parseFloat(rowEdit.expected_selling_price_per_bundle || '0');
    if (!(expected >= 0)) return setMessage('Expected selling price per bundle must be >= 0.');

    const { error } = await supabaseClient
      .schema('app')
      .from('bundles')
      .update({
        expected_selling_price_per_bundle: expected,
        sku: rowEdit.sku?.trim() ? rowEdit.sku.trim() : null,
        is_active: !!rowEdit.is_active,
      })
      .eq('id', bundleId);

    if (error) return setMessage(`Error saving changes: ${error.message}`);

    setMessage('✅ Bundle type updated (applies going forward).');
    await loadBundles();

    if (selectedSupplierId) {
      await loadSupplierCosts(selectedSupplierId);
    }
  };

  const updateBuyEdit = (bundleId, value) => {
    setBuyEdit((prev) => ({ ...prev, [bundleId]: value }));
  };

  const saveSupplierBuyingPrices = async () => {
    setMessage('');

    if (!selectedSupplierId) {
      return setMessage('Select a supplier to set buying prices.');
    }

    setSavingBuy(true);
    try {
      // Upsert only rows that have a value (empty allowed)
      const payload = Object.entries(buyEdit)
        .map(([bundleId, val]) => ({
          bundle_id: bundleId,
          supplier_id: selectedSupplierId,
          val: val,
        }))
        .filter((x) => x.val !== null && String(x.val).trim() !== '');

      for (const item of payload) {
        const cost = parseFloat(item.val);
        if (!(cost >= 0)) {
          throw new Error('Buying price must be >= 0 for all filled values.');
        }

        const { error } = await supabaseClient.schema('app').from('supplier_bundle_costs').upsert(
          [
            {
              supplier_id: item.supplier_id,
              bundle_id: item.bundle_id,
              default_cost_per_bundle: cost,
              updated_at: new Date().toISOString(),
            },
          ],
          { onConflict: 'supplier_id,bundle_id' }
        );

        if (error) throw error;
      }

      setMessage(
        `✅ Saved default buying prices for supplier: ${supplierNameById.get(selectedSupplierId) || selectedSupplierId}`
      );

      await loadSupplierCosts(selectedSupplierId);
    } catch (err) {
      setMessage(`Error saving buying prices: ${err?.message || 'Unknown error'}`);
    } finally {
      setSavingBuy(false);
    }
  };

  return (
    <div className="card">
      <h2>➕ Manage Bundle Types</h2>

      <div className="message" style={{ marginBottom: 12 }}>
        <div>
          <strong>Rules:</strong> You buy <strong>bundles</strong> and sell <strong>packs</strong>. “Packs per bundle” is fixed forever.
          Buying price is <strong>per supplier</strong>.
        </div>
      </div>

      {message && <p className={`message ${message.startsWith('Error') ? 'error' : ''}`}>{message}</p>}

      <h3>Add Bundle Type</h3>
      <form onSubmit={handleSubmit} className="form-grid">
        <div className="form-group">
          <label>Bundle Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>

        <div className="form-group">
          <label>Packs per Bundle (fixed)</label>
          <input
            type="number"
            min="1"
            value={packsPerBundle}
            onChange={(e) => setPacksPerBundle(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label>Expected Selling Price per Bundle (LKR) (mandatory)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={expectedSellPerBundle}
            onChange={(e) => setExpectedSellPerBundle(e.target.value)}
            required
          />
          <small>Record Sale will default price/pack as (expected sell ÷ packs per bundle).</small>
        </div>

        <div className="form-group">
          <label>SKU / Code (optional)</label>
          <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Optional" />
        </div>

        <div className="form-actions">
          <button type="submit" className="button primary">Add Bundle Type</button>
          <button type="button" className="button secondary" onClick={loadBundles}>Refresh</button>
        </div>
      </form>

      <hr />

      <h3>Existing Bundle Types (Edit)</h3>
      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <div className="responsive-table">
          <table className="moderntable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Packs/Bundle</th>
                <th>Expected Sell (LKR/Bundle)</th>
                <th>SKU</th>
                <th>Active</th>
                <th style={{ width: 140 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan="6">No bundle types found.</td></tr>
              ) : (
                rows.map((r) => {
                  const e = edit[r.id] || {};
                  return (
                    <tr key={r.id}>
                      <td><strong>{r.name}</strong></td>
                      <td>{r.packs_per_bundle}</td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={e.expected_selling_price_per_bundle ?? ''}
                          onChange={(ev) => updateEdit(r.id, 'expected_selling_price_per_bundle', ev.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          value={e.sku ?? ''}
                          onChange={(ev) => updateEdit(r.id, 'sku', ev.target.value)}
                          placeholder="Optional"
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={!!e.is_active}
                          onChange={(ev) => updateEdit(r.id, 'is_active', ev.target.checked)}
                        />
                      </td>
                      <td>
                        <button className="button primary" type="button" onClick={() => saveBundleEdit(r.id)}>
                          Save
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          <div style={{ marginTop: 10, color: '#64748b' }}>
            <small>
              Note: “Default supplier cost per bundle” inside bundles is obsolete. Buying defaults are managed per supplier below.
            </small>
          </div>
        </div>
      )}

      <hr />

      <h3>Default Buying Price per Supplier (for Record Borrowing)</h3>

      <div className="form-grid" style={{ marginBottom: 10 }}>
        <div className="form-group">
          <label>Select Supplier</label>
          <select value={selectedSupplierId} onChange={(e) => setSelectedSupplierId(e.target.value)}>
            <option value="">Select supplier...</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <small>
            Set default buying price per bundle for the selected supplier. Record Borrowing will auto-fill from this.
          </small>
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="button primary"
            onClick={saveSupplierBuyingPrices}
            disabled={!selectedSupplierId || savingBuy}
            title="Saves only filled values; empty means no default yet"
          >
            {savingBuy ? 'Saving...' : 'Save Buying Prices'}
          </button>

          <button
            type="button"
            className="button secondary"
            onClick={() => selectedSupplierId && loadSupplierCosts(selectedSupplierId)}
            disabled={!selectedSupplierId || savingBuy}
          >
            Refresh Supplier Prices
          </button>
        </div>
      </div>

      {!selectedSupplierId ? (
        <div className="loading">Select a supplier to edit buying prices.</div>
      ) : (
        <div className="responsive-table">
          <table className="moderntable">
            <thead>
              <tr>
                <th>Bundle</th>
                <th>Default Buying Price (LKR / Bundle)</th>
                <th>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan="3">No bundles found.</td></tr>
              ) : (
                rows.map((b) => {
                  const costRow = supplierCosts.find((x) => x.bundle_id === b.id) || null;
                  const lastUpdated = costRow?.updated_at
                    ? new Date(costRow.updated_at).toLocaleString('en-LK', { timeZone: 'Asia/Colombo' })
                    : '—';

                  return (
                    <tr key={b.id}>
                      <td><strong>{b.name}</strong></td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={buyEdit[b.id] ?? ''}
                          onChange={(e) => updateBuyEdit(b.id, e.target.value)}
                          placeholder="Leave empty to set later"
                        />
                        <small style={{ color: '#64748b' }}>
                          Empty is allowed; it will fill naturally on first purchase.
                        </small>
                      </td>
                      <td>{lastUpdated}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          <div style={{ marginTop: 10, color: '#64748b' }}>
            <small>
              If you enter a buying price during Record Borrowing, we will update this supplier’s default for that bundle automatically (going forward).
            </small>
          </div>
        </div>
      )}
    </div>
  );
}
