import React, { useCallback, useEffect, useMemo, useState } from 'react';

function toLocalDateTimeInputValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

export default function RecordBorrowingForm({ supabaseClient }) {
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');

  const [suppliers, setSuppliers] = useState([]);
  const [supplierQuery, setSupplierQuery] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [showSupplierSuggestions, setShowSupplierSuggestions] = useState(false);

  const [bundles, setBundles] = useState([]);

  const [supplierCosts, setSupplierCosts] = useState([]);
  const supplierCostMap = useMemo(() => {
    const m = new Map(); // key = `${supplierId}:${bundleId}`
    for (const r of supplierCosts) m.set(`${r.supplier_id}:${r.bundle_id}`, Number(r.default_cost_per_bundle || 0));
    return m;
  }, [supplierCosts]);

  const [lines, setLines] = useState([{ bundle_id: '', bundles_qty: '', unit_cost_per_bundle: '' }]);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [discount, setDiscount] = useState('0');
  const [otherCharges, setOtherCharges] = useState('0');
  const [notes, setNotes] = useState('');

  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const loadSuppliers = useCallback(async () => {
    const { data, error } = await supabaseClient
      .schema('app')
      .from('suppliers')
      .select('id,name,is_active')
      .eq('is_active', true)
      .order('name');

    if (!error) setSuppliers(data || []);
  }, [supabaseClient]);

  const loadBundles = useCallback(async () => {
    const { data, error } = await supabaseClient
      .schema('app')
      .from('bundles')
      .select('id,name,packs_per_bundle,expected_selling_price_per_bundle,is_active')
      .eq('is_active', true)
      .order('name');

    if (!error) setBundles(data || []);
  }, [supabaseClient]);

  // ✅ FIX: return rows so we can build a fresh map immediately (no stale state)
  const loadSupplierCosts = useCallback(
    async (supplierId) => {
      if (!supplierId) {
        setSupplierCosts([]);
        return [];
      }
      const { data, error } = await supabaseClient
        .schema('app')
        .from('supplier_bundle_costs')
        .select('supplier_id,bundle_id,default_cost_per_bundle,updated_at')
        .eq('supplier_id', supplierId);

      if (!error) {
        const rows = data || [];
        setSupplierCosts(rows);
        return rows;
      }
      setSupplierCosts([]);
      return [];
    },
    [supabaseClient]
  );

  const getNextInvoiceNo = useCallback(async () => {
    const { data, error } = await supabaseClient.schema('app').rpc('fn_next_invoice_no', {
      p_series: 'purchase',
    });

    if (error) {
      setMessage(`Invoice number auto-gen failed: ${error.message}`);
      return '';
    }
    return String(data || '');
  }, [supabaseClient]);

  useEffect(() => {
    setInvoiceDate(toLocalDateTimeInputValue(new Date()));
    loadSuppliers();
    loadBundles();

    (async () => {
      const next = await getNextInvoiceNo();
      if (next) setInvoiceNo(next);
    })();
  }, [loadSuppliers, loadBundles, getNextInvoiceNo]);

  const supplierSuggestions = useMemo(() => {
    const q = supplierQuery.trim().toLowerCase();
    if (!q) return [];
    return suppliers.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8);
  }, [suppliers, supplierQuery]);

  const selectSupplier = async (s) => {
    setSelectedSupplier(s);
    setSupplierQuery(s.name);
    setShowSupplierSuggestions(false);

    // ✅ FIX: get fresh costs NOW and apply immediately
    const rows = await loadSupplierCosts(s.id);
    const freshMap = new Map();
    for (const r of rows) freshMap.set(`${r.supplier_id}:${r.bundle_id}`, Number(r.default_cost_per_bundle || 0));

    // Re-apply defaults to any line that has a bundle but empty cost
    setLines((prev) =>
      prev.map((l) => {
        if (!l.bundle_id) return l;
        if (l.unit_cost_per_bundle) return l;
        const cost = freshMap.get(`${s.id}:${l.bundle_id}`);
        return cost != null ? { ...l, unit_cost_per_bundle: String(cost) } : l;
      })
    );
  };

  const quickCreateSupplier = async () => {
    setMessage('');
    const name = supplierQuery.trim();
    if (!name) return setMessage('Enter a supplier name.');
    setIsSaving(true);

    const { data, error } = await supabaseClient
      .schema('app')
      .from('suppliers')
      .insert([{ name, is_active: true }])
      .select('id,name')
      .single();

    setIsSaving(false);
    if (error) return setMessage(`Supplier create failed: ${error.message}`);

    await loadSuppliers();
    await selectSupplier(data);
    setMessage('✅ Supplier created. Default costs can remain empty until first purchase.');
  };

  const updateLine = (idx, field, value) => {
    const copy = [...lines];
    copy[idx] = { ...copy[idx], [field]: value };

    // Auto-fill cost when selecting a bundle if supplier default exists
    if (field === 'bundle_id') {
      const sid = selectedSupplier?.id;
      if (sid && !copy[idx].unit_cost_per_bundle) {
        const cost = supplierCostMap.get(`${sid}:${value}`);
        if (cost != null) copy[idx].unit_cost_per_bundle = String(cost);
      }
    }

    setLines(copy);
  };

  const addLine = () => setLines([...lines, { bundle_id: '', bundles_qty: '', unit_cost_per_bundle: '' }]);
  const removeLine = (idx) => setLines(lines.filter((_, i) => i !== idx));

  const calc = useMemo(() => {
    const clean = lines
      .map((l) => ({
        bundle_id: l.bundle_id,
        bundles_qty: parseInt(l.bundles_qty, 10),
        unit_cost_per_bundle: parseFloat(l.unit_cost_per_bundle),
      }))
      .filter((l) => l.bundle_id && l.bundles_qty > 0 && l.unit_cost_per_bundle >= 0);

    const subtotal = clean.reduce((sum, l) => sum + l.bundles_qty * l.unit_cost_per_bundle, 0);
    const disc = showAdvanced ? parseFloat(discount || '0') || 0 : 0;
    const other = showAdvanced ? parseFloat(otherCharges || '0') || 0 : 0;
    const total = Math.max(0, subtotal - disc + other);
    return { cleanLines: clean, subtotal, disc, other, total };
  }, [lines, discount, otherCharges, showAdvanced]);

  const upsertSupplierBundleCost = async (supplierId, bundleId, cost) => {
    const { error } = await supabaseClient.schema('app').from('supplier_bundle_costs').upsert(
      [
        {
          supplier_id: supplierId,
          bundle_id: bundleId,
          default_cost_per_bundle: cost,
          updated_at: new Date().toISOString(),
        },
      ],
      { onConflict: 'supplier_id,bundle_id' }
    );
    if (error) throw error;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    if (isSaving) return;

    if (!invoiceNo.trim()) return setMessage('Purchase invoice number is required (auto-gen failed).');
    if (!selectedSupplier?.id) return setMessage('Select or create a supplier.');
    if (calc.cleanLines.length === 0) return setMessage('Add at least one valid line.');

    setIsSaving(true);

    try {
      const { error } = await supabaseClient.schema('app').rpc('fn_create_purchase_invoice', {
        p_invoice_no: invoiceNo.trim(),
        p_supplier_id: selectedSupplier.id,
        p_invoice_date: new Date(invoiceDate).toISOString(),
        p_due_date: null,
        p_discount: calc.disc,
        p_other_charges: calc.other,
        p_notes: showAdvanced ? notes || null : null,
        p_lines: calc.cleanLines,
      });

      if (error) throw error;

      for (const l of calc.cleanLines) {
        await upsertSupplierBundleCost(selectedSupplier.id, l.bundle_id, l.unit_cost_per_bundle);
      }

      setMessage('✅ Purchase invoice created (credit). Supplier default costs updated for future purchases.');

      const next = await getNextInvoiceNo();
      if (next) setInvoiceNo(next);

      setLines([{ bundle_id: '', bundles_qty: '', unit_cost_per_bundle: '' }]);
      setShowAdvanced(false);
      setDiscount('0');
      setOtherCharges('0');
      setNotes('');

      await loadSupplierCosts(selectedSupplier.id);
    } catch (err) {
      setMessage(`Error creating purchase invoice: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="card">
      <h2>📥 Create Purchase Invoice (Bundles) — Credit Only</h2>

      {message && <p className={`message ${message.startsWith('Error') ? 'error' : ''}`}>{message}</p>}

      <form onSubmit={handleSubmit} className="form-grid">
        <div className="form-group">
          <label>Invoice No (auto)</label>
          <input value={invoiceNo} readOnly />
        </div>

        <div className="form-group">
          <label>Date & Time (Sri Lanka)</label>
          <input type="datetime-local" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
        </div>

        <div className="form-group" style={{ position: 'relative' }}>
          <label>Supplier (type to search)</label>
          <input
            value={supplierQuery}
            onChange={(e) => {
              setSupplierQuery(e.target.value);
              setShowSupplierSuggestions(true);
              setSelectedSupplier(null);
              setSupplierCosts([]);
            }}
            onFocus={() => setShowSupplierSuggestions(true)}
            placeholder="Type supplier name..."
            required
          />

          {showSupplierSuggestions && supplierSuggestions.length > 0 && (
            <ul className="suggestions" style={{ position: 'absolute', width: '100%', zIndex: 5 }}>
              {supplierSuggestions.map((s) => (
                <li key={s.id} onClick={() => selectSupplier(s)}>
                  {s.name}
                </li>
              ))}
            </ul>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" className="button secondary" onClick={quickCreateSupplier} disabled={isSaving || !supplierQuery.trim()}>
              + Quick Create Supplier
            </button>

            {selectedSupplier?.id && (
              <small style={{ color: '#64748b' }}>
                Selected: <strong>{selectedSupplier.name}</strong>
              </small>
            )}
          </div>

          <small style={{ color: '#64748b' }}>
            Supplier default bundle costs can be empty and will fill naturally on first purchase per bundle.
          </small>
        </div>

        <hr />

        {lines.map((l, idx) => (
          <div key={idx} className="form-group" style={{ border: '1px solid #eee', padding: 12, borderRadius: 8 }}>
            <label>Bundle</label>
            <select value={l.bundle_id} onChange={(e) => updateLine(idx, 'bundle_id', e.target.value)} required>
              <option value="">Select bundle</option>
              {bundles.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} (1 bundle = {b.packs_per_bundle} packs)
                </option>
              ))}
            </select>

            <label style={{ marginTop: 8 }}>Bundles Qty</label>
            <input type="number" min="1" value={l.bundles_qty} onChange={(e) => updateLine(idx, 'bundles_qty', e.target.value)} required />

            <label style={{ marginTop: 8 }}>Unit Cost per Bundle (LKR)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={l.unit_cost_per_bundle}
              onChange={(e) => updateLine(idx, 'unit_cost_per_bundle', e.target.value)}
              required
            />
            <small style={{ color: '#64748b' }}>
              This can change per purchase. We will remember it as the supplier’s default for next time.
            </small>

            {lines.length > 1 && (
              <button type="button" className="button secondary" onClick={() => removeLine(idx)} style={{ marginTop: 8 }} disabled={isSaving}>
                Remove line
              </button>
            )}
          </div>
        ))}

        <button type="button" className="button secondary" onClick={addLine} disabled={isSaving}>
          + Add another line
        </button>

        <hr />

        <div className="form-group">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 18, cursor: 'pointer' }} onClick={() => setShowAdvanced((v) => !v)}>
              {showAdvanced ? '⬇️' : '➡️'}
            </span>
            Advanced (Discount / Charges / Notes)
          </label>

          {showAdvanced && (
            <div style={{ display: 'grid', gap: 10 }}>
              <div className="form-group">
                <label>Discount (LKR)</label>
                <input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </div>

              <div className="form-group">
                <label>Other Charges (LKR)</label>
                <input type="number" step="0.01" value={otherCharges} onChange={(e) => setOtherCharges(e.target.value)} />
              </div>

              <div className="form-group">
                <label>Notes</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
              </div>
            </div>
          )}
        </div>

        <div className="metric-card" style={{ textAlign: 'left' }}>
          <strong>Live Summary</strong>
          <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
            <div>Subtotal: LKR {calc.subtotal.toFixed(2)}</div>
            <div>Discount: LKR {calc.disc.toFixed(2)}</div>
            <div>Other Charges: LKR {calc.other.toFixed(2)}</div>
            <div style={{ marginTop: 6 }}>
              <strong>Total: LKR {calc.total.toFixed(2)}</strong>
            </div>
          </div>
        </div>

        <div className="form-actions">
          <button className="button primary" type="submit" disabled={isSaving}>
            {isSaving ? 'Saving...' : '✅ Create Purchase Invoice'}
          </button>
        </div>
      </form>
    </div>
  );
}
