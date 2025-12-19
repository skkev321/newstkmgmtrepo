import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCustomers } from '../hooks/useCustomers';
import { useStock } from '../hooks/useStock';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Plus, Trash2, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

function toLocalDateTimeInputValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

export default function RecordSaleForm({ supabaseClient }) {
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');

  // Hooks
  const { customers, loading: customersLoading, createCustomer, refresh: refreshCustomers } = useCustomers(supabaseClient);
  const { stock, stockByBundle, loading: stockLoading, refresh: refreshStock } = useStock(supabaseClient);

  // Local state for UI
  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);

  const [lines, setLines] = useState([{ bundle_id: '', packs_qty: '', unit_price: '' }]);

  const [showMore, setShowMore] = useState(false);
  const [discount, setDiscount] = useState('0');
  const [otherCharges, setOtherCharges] = useState('0');
  const [notes, setNotes] = useState('');

  const [recordPaymentNow, setRecordPaymentNow] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentAmount, setPaymentAmount] = useState('');

  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const customerBoxRef = useRef(null);

  const loadInvoiceNo = useCallback(async () => {
    const { data, error } = await supabaseClient.schema('app').rpc('fn_next_invoice_no', { p_series: 'sales' });
    if (!error) setInvoiceNo(String(data || ''));
    else setMessage(`Invoice number auto-gen failed: ${error.message}`);
  }, [supabaseClient]);

  useEffect(() => {
    setInvoiceDate(toLocalDateTimeInputValue(new Date()));
    loadInvoiceNo();
  }, [loadInvoiceNo]);

  // Click outside to close suggestions
  useEffect(() => {
    const onDocClick = (e) => {
      if (!customerBoxRef.current) return;
      if (!customerBoxRef.current.contains(e.target)) setShowCustomerSuggestions(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const customerSuggestions = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return [];
    return customers.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 7);
  }, [customers, customerQuery]);

  const selectCustomer = (c) => {
    setSelectedCustomer(c);
    setCustomerQuery(c.name);
    setShowCustomerSuggestions(false);
  };

  const handleQuickCreateCustomer = async () => {
    const name = customerQuery.trim();
    if (!name) return;
    try {
      const newCustomer = await createCustomer(name);
      selectCustomer(newCustomer);
    } catch (err) {
      setMessage(`Error creating customer: ${err.message}`);
    }
  };

  const updateLine = (idx, field, value) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  const addLine = () => setLines((prev) => [...prev, { bundle_id: '', packs_qty: '', unit_price: '' }]);
  const removeLine = (idx) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const totals = useMemo(() => {
    const subtotal = (lines || []).reduce((sum, l) => {
      const qty = parseInt(l.packs_qty, 10) || 0;
      const price = parseFloat(l.unit_price) || 0;
      return sum + qty * price;
    }, 0);

    const disc = parseFloat(discount || '0') || 0;
    const other = parseFloat(otherCharges || '0') || 0;
    const total = Math.max(0, subtotal - disc + other);
    return { subtotal, disc, other, total };
  }, [lines, discount, otherCharges]);

  // [Helper function] getUnitCostPerPackMap (Logic preserved from original)
  const getUnitCostPerPackMap = async (bundleIds) => {
    if (!bundleIds.length) return { map: new Map(), missing: [] };
    const { data: bundleMeta, error: bundleErr } = await supabaseClient
      .schema('app').from('bundles').select('id,packs_per_bundle').in('id', bundleIds);
    if (bundleErr) throw bundleErr;

    const ppb = new Map();
    for (const b of bundleMeta || []) ppb.set(b.id, Number(b.packs_per_bundle || 0));

    const { data: moves, error: moveErr } = await supabaseClient
      .schema('app').from('stock_movements')
      .select('bundle_id,purchase_invoice_id,movement_datetime,packs_delta')
      .in('bundle_id', bundleIds)
      .not('purchase_invoice_id', 'is', null)
      .gt('packs_delta', 0)
      .order('movement_datetime', { ascending: false });
    if (moveErr) throw moveErr;

    const latestPurchaseInv = new Map();
    for (const m of moves || []) {
      if (!latestPurchaseInv.has(m.bundle_id)) latestPurchaseInv.set(m.bundle_id, m.purchase_invoice_id);
    }
    const invoiceIds = Array.from(new Set(Array.from(latestPurchaseInv.values()).filter(Boolean)));
    const costPerBundle = new Map();

    if (invoiceIds.length > 0) {
      const { data: pil, error: pilErr } = await supabaseClient
        .schema('app').from('purchase_invoice_lines')
        .select('invoice_id,bundle_id,unit_cost_per_bundle')
        .in('invoice_id', invoiceIds).in('bundle_id', bundleIds);
      if (pilErr) throw pilErr;

      for (const row of pil || []) {
        const expected = latestPurchaseInv.get(row.bundle_id);
        if (expected && row.invoice_id === expected) {
          costPerBundle.set(row.bundle_id, Number(row.unit_cost_per_bundle || 0));
        }
      }
    }

    const map = new Map();
    const missing = [];
    for (const id of bundleIds) {
      const packs = ppb.get(id) || 0;
      const bundleCost = costPerBundle.get(id);
      if (!packs || bundleCost === undefined) {
        map.set(id, 0);
        missing.push(id);
      } else {
        map.set(id, bundleCost / packs);
      }
    }
    return { map, missing };
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (isSaving) return;
    setMessage('');
    setIsSaving(true);

    try {
      if (!invoiceNo.trim()) throw new Error('Invoice number is required.');
      if (!selectedCustomer) throw new Error('Select a customer.');

      const cleanLines = lines
        .map((l) => ({
          bundle_id: l.bundle_id,
          packs_qty: parseInt(l.packs_qty, 10),
          unit_price: parseFloat(l.unit_price),
        }))
        .filter((l) => l.bundle_id && l.packs_qty > 0 && l.unit_price >= 0);

      if (cleanLines.length === 0) throw new Error('Add at least one valid line.');

      for (const l of cleanLines) {
        const stockInfo = stockByBundle.get(l.bundle_id);
        const currentStock = stockInfo?.packs_in_stock ?? 0;
        if (l.packs_qty > currentStock) {
          throw new Error(`Not enough stock for ${stockInfo?.name || 'bundle'}. In stock: ${currentStock}`);
        }
      }

      const bundleIds = Array.from(new Set(cleanLines.map((l) => l.bundle_id)));
      const { map: unitCostPerPackMap, missing } = await getUnitCostPerPackMap(bundleIds);

      // 1) Create invoice
      const { data: invoiceId, error: createErr } = await supabaseClient.schema('app').rpc('fn_create_sales_invoice_api', {
        p_invoice_no: invoiceNo.trim(),
        p_customer_id: selectedCustomer.id,
        p_invoice_date: new Date(invoiceDate).toISOString(),
      });
      if (createErr) throw createErr;

      // 2) Insert lines
      const lineRows = cleanLines.map((l) => ({
        invoice_id: invoiceId,
        bundle_id: l.bundle_id,
        packs_qty: l.packs_qty,
        unit_price: l.unit_price,
        unit_cost: unitCostPerPackMap.get(l.bundle_id) ?? 0,
        line_total: l.packs_qty * l.unit_price,
      }));
      const { error: lineErr } = await supabaseClient.schema('app').from('sales_invoice_lines').insert(lineRows);
      if (lineErr) throw lineErr;

      // 3) Stock movements
      const movementRows = cleanLines.map((l) => ({
        movement_type: 'sale_out',
        movement_datetime: new Date().toISOString(),
        bundle_id: l.bundle_id,
        packs_delta: -Math.abs(l.packs_qty),
        sales_invoice_id: invoiceId,
        purchase_invoice_id: null,
        reason: `Sale ${invoiceNo.trim()}`,
      }));
      const { error: mvErr } = await supabaseClient.schema('app').from('stock_movements').insert(movementRows);
      if (mvErr) throw mvErr;

      // 4) Update invoice totals
      const { error: updErr } = await supabaseClient.schema('app').from('sales_invoices').update({
        discount: parseFloat(discount || '0') || 0,
        other_charges: parseFloat(otherCharges || '0') || 0,
        notes: notes?.trim() ? notes.trim() : null,
      }).eq('id', invoiceId);
      if (updErr) throw updErr;

      // 5) Recalc
      await supabaseClient.schema('app').rpc('fn_recalc_sales_invoice_totals', { p_invoice_id: invoiceId });

      // 6) Payment
      if (recordPaymentNow) {
        const amount = parseFloat(paymentAmount || '0');
        if (amount > 0) {
          const { data: invRow } = await supabaseClient.schema('app').from('sales_invoices').select('total').eq('id', invoiceId).single();
          const applyAmount = Math.min(amount, Number(invRow?.total || 0));

          const { data: payRow, error: payErr } = await supabaseClient.schema('app').from('payments').insert([{
            party_type: 'customer',
            customer_id: selectedCustomer.id,
            amount,
            payment_date: new Date().toISOString(),
            method: paymentMethod || 'cash',
            note: `Payment for ${invoiceNo.trim()}`,
            source: 'record_sale',
          }]).select('id').single();
          if (payErr) throw payErr;

          await supabaseClient.schema('app').from('payment_allocations').insert([{
            payment_id: payRow.id,
            invoice_type: 'sale',
            sales_invoice_id: invoiceId,
            amount_applied: applyAmount,
          }]);
        }
      }

      setMessage(missing.length > 0
        ? `✅ Sale recorded: ${invoiceNo.trim()}\n⚠️ Some bundles had no purchase history. Cost saved as 0.`
        : `✅ Sale recorded: ${invoiceNo.trim()}`
      );

      // Reset
      setSelectedCustomer(null);
      setCustomerQuery('');
      setLines([{ bundle_id: '', packs_qty: '', unit_price: '' }]);
      setDiscount('0');
      setOtherCharges('0');
      setNotes('');
      setPaymentAmount('');
      setShowMore(false);
      await loadInvoiceNo();
      refreshStock(); // Refresh stock hook

    } catch (err) {
      setMessage(`Error: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="w-full max-w-4xl mx-auto shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span>🧾</span> Record Sale
        </CardTitle>
      </CardHeader>
      <CardContent>
        {message && (
          <div className={`p-3 mb-4 rounded-md text-sm font-medium ${message.startsWith('Error') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
            <pre className="whitespace-pre-wrap font-sans">{message}</pre>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Invoice No</label>
              <Input value={invoiceNo} readOnly className="bg-muted" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Date & Time</label>
              <Input type="datetime-local" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
            </div>
          </div>

          <div className="space-y-2 relative" ref={customerBoxRef}>
            <label className="text-sm font-medium text-muted-foreground">Customer</label>
            <Input
              value={customerQuery}
              onChange={(e) => {
                setCustomerQuery(e.target.value);
                setSelectedCustomer(null);
                setShowCustomerSuggestions(true);
              }}
              onFocus={() => setShowCustomerSuggestions(true)}
              placeholder="Search customer..."
              required
            />
            {showCustomerSuggestions && customerSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg z-50 max-h-60 overflow-y-auto">
                {customerSuggestions.map((c) => (
                  <div key={c.id} onClick={() => selectCustomer(c)} className="p-2 hover:bg-accent hover:text-accent-foreground cursor-pointer text-sm">
                    {c.name}
                  </div>
                ))}
              </div>
            )}
            {!selectedCustomer && customerQuery.trim() && (
              <Button type="button" variant="outline" size="sm" onClick={handleQuickCreateCustomer} disabled={isSaving || customersLoading} className="mt-2">
                + Create "{customerQuery}"
              </Button>
            )}
            {selectedCustomer && <div className="text-xs text-green-600 font-medium mt-1">Selected: {selectedCustomer.name}</div>}
          </div>

          <div className="border rounded-lg p-4 bg-gray-50/50">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold text-sm">Items</h3>
              <Button type="button" size="sm" variant="outline" onClick={addLine} disabled={isSaving}>
                <Plus className="h-4 w-4 mr-2" /> Add Line
              </Button>
            </div>

            <div className="space-y-4">
              {lines.map((l, idx) => {
                const stockInfo = stockByBundle.get(l.bundle_id);
                const stockCount = stockInfo?.packs_in_stock ?? 0;

                return (
                  <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start border p-3 rounded-md bg-white">
                    <div className="md:col-span-5 space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Bundle</label>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        value={l.bundle_id}
                        onChange={(e) => updateLine(idx, 'bundle_id', e.target.value)}
                        required
                      >
                        <option value="">Select Bundle</option>
                        {stock.map(b => (
                          <option key={b.bundle_id} value={b.bundle_id}>{b.name} (Stock: {b.packs_in_stock})</option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-3 space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Packs</label>
                      <Input
                        type="number"
                        min="1"
                        value={l.packs_qty}
                        onChange={(e) => updateLine(idx, 'packs_qty', e.target.value)}
                        required
                      />
                      {l.bundle_id && <div className="text-xs text-muted-foreground">Avl: {stockCount}</div>}
                    </div>

                    <div className="md:col-span-3 space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Price (LKR)</label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={l.unit_price}
                        onChange={(e) => updateLine(idx, 'unit_price', e.target.value)}
                        required
                      />
                    </div>

                    <div className="md:col-span-1 pt-6 flex justify-center">
                      {lines.length > 1 && (
                        <Button type="button" variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => removeLine(idx)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col md:flex-row justify-end items-end gap-8 mt-6 p-4 bg-muted/30 rounded-lg">
              <div className="text-right space-y-1 text-sm">
                <div className="flex justify-between w-48 text-muted-foreground"><span>Subtotal:</span> <span>{totals.subtotal.toFixed(2)}</span></div>
                <div className="flex justify-between w-48 text-muted-foreground"><span>Discount:</span> <span>{totals.disc.toFixed(2)}</span></div>
                <div className="flex justify-between w-48 text-muted-foreground"><span>Other:</span> <span>{totals.other.toFixed(2)}</span></div>
              </div>
              <div className="text-xl font-bold text-primary">
                Total: LKR {totals.total.toFixed(2)}
              </div>
            </div>
          </div>

          <div>
            <Button type="button" variant="ghost" onClick={() => setShowMore(!showMore)} className="flex items-center gap-2 text-muted-foreground">
              {showMore ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {showMore ? 'Hide' : 'Show'} Discount, Charges & Notes
            </Button>

            {showMore && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 p-4 border rounded-lg bg-gray-50/50 animation-fade-in">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Discount</label>
                  <Input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Other Charges</label>
                  <Input type="number" step="0.01" value={otherCharges} onChange={(e) => setOtherCharges(e.target.value)} />
                </div>
                <div className="space-y-2 md:col-span-3">
                  <label className="text-sm font-medium">Notes</label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional transaction notes..." />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4 pt-4 border-t">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" checked={recordPaymentNow} onChange={(e) => setRecordPaymentNow(e.target.checked)} disabled={isSaving} />
              <span className="font-medium">Record Payment Now</span>
            </label>

            {recordPaymentNow && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-6 border-l-2 border-primary/20">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Payment Method</label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  >
                    <option value="cash">Cash</option>
                    <option value="bank">Bank</option>
                    <option value="transfer">Transfer</option>
                    <option value="card">Card</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Amount (LKR)</label>
                  <Input type="number" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} placeholder="Full amount or partial..." />
                </div>
              </div>
            )}
          </div>

          <div className="pt-6">
            <Button type="submit" className="w-full md:w-auto md:min-w-[200px]" disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSaving ? 'Processing...' : 'Complete Sale'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
