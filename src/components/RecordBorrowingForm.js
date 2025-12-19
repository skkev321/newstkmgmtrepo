import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Plus, Trash2, Save, ShoppingCart, ChevronDown, ChevronRight, Calculator, UserPlus, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { currencyFormatter } from './formatters';

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
    <div className="max-w-4xl mx-auto space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-xl">
            <ShoppingCart className="h-6 w-6 text-primary" /> Create Purchase Invoice
            <span className="text-sm font-normal text-muted-foreground ml-auto bg-secondary px-3 py-1 rounded-full">Credit Only</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {message && (
            <div className={cn("p-4 mb-6 rounded-md text-sm font-medium flex items-center gap-2", message.startsWith('Error') ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-600")}>
              <span>{message}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Header Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 rounded-lg bg-muted/40 border">
              <div className="space-y-2">
                <label className="text-sm font-medium">Invoice No <span className="text-muted-foreground">(Auto)</span></label>
                <Input value={invoiceNo} readOnly className="font-mono bg-muted" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Date & Time</label>
                <Input type="datetime-local" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
              </div>

              <div className="md:col-span-2 space-y-2 relative">
                <label className="text-sm font-medium">Supplier</label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={supplierQuery}
                    onChange={(e) => {
                      setSupplierQuery(e.target.value);
                      setShowSupplierSuggestions(true);
                      setSelectedSupplier(null);
                      setSupplierCosts([]);
                    }}
                    onFocus={() => setShowSupplierSuggestions(true)}
                    placeholder="Type to search..."
                    className="pl-9"
                    required
                  />
                </div>

                {showSupplierSuggestions && supplierSuggestions.length > 0 && (
                  <div className="absolute z-10 w-full bg-popover text-popover-foreground border rounded-md shadow-md mt-1 overflow-hidden">
                    {supplierSuggestions.map((s) => (
                      <div
                        key={s.id}
                        className="px-4 py-2 hover:bg-muted cursor-pointer text-sm"
                        onClick={() => selectSupplier(s)}
                      >
                        {s.name}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between mt-2">
                  <div className="text-xs text-muted-foreground">
                    {selectedSupplier?.id && <span>Selected: <span className="font-semibold text-foreground">{selectedSupplier.name}</span></span>}
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={quickCreateSupplier} disabled={isSaving || !supplierQuery.trim()}>
                    <UserPlus className="h-3.5 w-3.5 mr-2" /> Quick Create "{supplierQuery || '...'}"
                  </Button>
                </div>
              </div>
            </div>

            {/* Line Items */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2"><ShoppingCart className="h-4 w-4" /> Items</h3>
                <Button type="button" variant="outline" size="sm" onClick={addLine} disabled={isSaving}>
                  <Plus className="h-3.5 w-3.5 mr-2" /> Add Item
                </Button>
              </div>

              <div className="space-y-3">
                {lines.map((l, idx) => (
                  <div key={idx} className="flex flex-col md:flex-row gap-3 items-start md:items-end p-4 rounded-lg border bg-card hover:border-primary/50 transition-colors">
                    <div className="flex-1 w-full space-y-2">
                      <label className="text-xs font-medium">Bundle Type</label>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={l.bundle_id}
                        onChange={(e) => updateLine(idx, 'bundle_id', e.target.value)}
                        required
                      >
                        <option value="">Select Bundle...</option>
                        {bundles.map(b => (
                          <option key={b.id} value={b.id}>
                            {b.name} ({b.packs_per_bundle} packs)
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="w-full md:w-32 space-y-2">
                      <label className="text-xs font-medium">Qty (Bundles)</label>
                      <Input type="number" min="1" value={l.bundles_qty} onChange={(e) => updateLine(idx, 'bundles_qty', e.target.value)} required />
                    </div>

                    <div className="w-full md:w-40 space-y-2">
                      <label className="text-xs font-medium">Cost/Bundle (LKR)</label>
                      <Input type="number" step="0.01" min="0" value={l.unit_cost_per_bundle} onChange={(e) => updateLine(idx, 'unit_cost_per_bundle', e.target.value)} required />
                    </div>

                    <div className="pb-1">
                      {lines.length > 1 && (
                        <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => removeLine(idx)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Advanced & Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
              {/* Advanced Section */}
              <div className="space-y-4">
                <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => setShowAdvanced(!showAdvanced)}>
                  {showAdvanced ? <ChevronDown className="h-4 w-4 mr-2" /> : <ChevronRight className="h-4 w-4 mr-2" />}
                  Advanced (Discounts, Notes)
                </Button>

                {showAdvanced && (
                  <div className="space-y-4 p-4 rounded-lg bg-muted/30 border animate-in slide-in-from-top-2 duration-200">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Discount (LKR)</label>
                      <Input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Other Charges (LKR)</label>
                      <Input type="number" step="0.01" value={otherCharges} onChange={(e) => setOtherCharges(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Notes</label>
                      <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional purchase notes..." />
                    </div>
                  </div>
                )}
              </div>

              {/* Summary Card */}
              <Card className="bg-muted/40 border-primary/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Calculator className="h-5 w-5" /> Summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{currencyFormatter.format(calc.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Discount</span>
                    <span className="text-destructive">-{currencyFormatter.format(calc.disc)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Charges</span>
                    <span>+{currencyFormatter.format(calc.other)}</span>
                  </div>
                  <div className="border-t pt-3 flex justify-between font-bold text-lg">
                    <span>Total Payable</span>
                    <span className="text-primary">{currencyFormatter.format(calc.total)}</span>
                  </div>

                  <Button size="lg" className="w-full mt-4" type="submit" disabled={isSaving}>
                    {isSaving ? (
                      <>
                        <ShoppingCart className="mr-2 h-4 w-4 animate-spin" /> Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" /> Create Purchase Invoice
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </div>

          </form>
        </CardContent>
      </Card>
    </div>
  );
}
