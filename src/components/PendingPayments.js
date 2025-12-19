import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { generateCustomerOutstandingReceipt, generateSupplierOutstandingReceipt } from './ReceiptModal';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Printer, Check, ChevronDown, ChevronRight, CreditCard, User, Truck } from 'lucide-react';
import { cn } from '../lib/utils';
import { currencyFormatter } from './formatters';

export default function PendingPayments({ supabaseClient }) {
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Tab state (default showing both or tabbed? Let's keep split view or tabs? Tabs are cleaner for mobile)
  const [activeTab, setActiveTab] = useState('customers'); // 'customers' | 'suppliers' | 'credits'

  const [salesBalances, setSalesBalances] = useState([]);
  const [purchaseBalances, setPurchaseBalances] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);

  const [customerCredit, setCustomerCredit] = useState([]);
  const [supplierAdvance, setSupplierAdvance] = useState([]);

  // Expanders
  const [expandedCustomerId, setExpandedCustomerId] = useState(null);
  const [expandedSupplierId, setExpandedSupplierId] = useState(null);

  // Pagination (global for SALES invoices)
  const [page, setPage] = useState(1);
  const pageSize = 5;

  // Customer partial UI
  const [partialInvoiceId, setPartialInvoiceId] = useState(null);
  const [partialAmount, setPartialAmount] = useState('');

  // Supplier partial UI
  const [partialPurchaseInvoiceId, setPartialPurchaseInvoiceId] = useState(null);
  const [partialPurchaseAmount, setPartialPurchaseAmount] = useState('');

  const customerNameById = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);
  const supplierNameById = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);

  const load = useCallback(async () => {
    setMessage('');

    const [
      { data: sb, error: sbErr },
      { data: pb, error: pbErr },
      { data: c, error: cErr },
      { data: s, error: sErr },
      { data: cc, error: ccErr },
      { data: sa, error: saErr },
    ] = await Promise.all([
      supabaseClient.schema('app').from('v_sales_invoice_balance').select('*'),
      supabaseClient.schema('app').from('v_purchase_invoice_balance').select('*'),
      supabaseClient.schema('app').from('customers').select('id,name,is_active').eq('is_active', true).order('name'),
      supabaseClient.schema('app').from('suppliers').select('id,name,is_active').eq('is_active', true).order('name'),
      supabaseClient.schema('app').from('v_customer_credit').select('*').order('name'),
      supabaseClient.schema('app').from('v_supplier_advance').select('*').order('name'),
    ]);

    const anyErr = sbErr || pbErr || cErr || sErr || ccErr || saErr;
    if (anyErr) {
      setMessage(`Error loading data: ${anyErr.message}`);
      return;
    }

    setSalesBalances((sb || []).filter((x) => Number(x.balance_due) > 0));
    setPurchaseBalances((pb || []).filter((x) => Number(x.balance_due) > 0));
    setCustomers(c || []);
    setSuppliers(s || []);
    setCustomerCredit(cc || []);
    setSupplierAdvance(sa || []);
  }, [supabaseClient]);

  useEffect(() => {
    load();
  }, [load]);

  // Global paging for SALES invoices
  const salesPaged = useMemo(() => {
    const sorted = [...salesBalances].sort((a, b) => String(b.invoice_date || '').localeCompare(String(a.invoice_date || '')));
    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const items = sorted.slice(start, start + pageSize);
    return { items, totalPages, safePage, totalCount: sorted.length };
  }, [salesBalances, page]);

  // Group customer invoices for ONLY the invoices on this page
  const customersOnPage = useMemo(() => {
    const map = new Map();
    for (const inv of salesPaged.items) {
      const cid = inv.customer_id;
      if (!map.has(cid)) map.set(cid, []);
      map.get(cid).push(inv);
    }
    return Array.from(map.entries()).map(([customer_id, invoices]) => {
      const balanceSum = invoices.reduce((sum, x) => sum + Number(x.balance_due || 0), 0);
      return { customer_id, invoices, balanceSum, count: invoices.length };
    });
  }, [salesPaged.items]);

  // Group ALL supplier invoices (no pagination needed)
  const suppliersGrouped = useMemo(() => {
    const map = new Map();
    const sorted = [...purchaseBalances].sort((a, b) => String(b.invoice_date || '').localeCompare(String(a.invoice_date || '')));
    for (const inv of sorted) {
      const sid = inv.supplier_id;
      if (!map.has(sid)) map.set(sid, []);
      map.get(sid).push(inv);
    }
    return Array.from(map.entries()).map(([supplier_id, invoices]) => {
      const balanceSum = invoices.reduce((sum, x) => sum + Number(x.balance_due || 0), 0);
      return { supplier_id, invoices, balanceSum, count: invoices.length };
    });
  }, [purchaseBalances]);

  // ===== CUSTOMER ACTIONS =====

  const markSalesInvoicePaid = async (inv) => {
    setMessage('');
    if (isSaving) return;

    const balanceDue = Number(inv.balance_due || 0);
    if (balanceDue <= 0) return;

    setIsSaving(true);
    try {
      const { data: paymentRow, error: payErr } = await supabaseClient
        .schema('app')
        .from('payments')
        .insert([
          {
            party_type: 'customer',
            customer_id: inv.customer_id,
            supplier_id: null,
            direction: 'in',
            amount: balanceDue,
            payment_date: new Date().toISOString(),
            method: 'cash',
            reference: null,
            note: `Mark paid: ${inv.invoice_no}`,
            source: 'mark_paid_button',
          },
        ])
        .select('id')
        .single();

      if (payErr) throw payErr;

      const { error: allocErr } = await supabaseClient.schema('app').from('payment_allocations').insert([
        {
          payment_id: paymentRow.id,
          invoice_type: 'sale',
          sales_invoice_id: inv.id,
          purchase_invoice_id: null,
          amount_applied: balanceDue,
        },
      ]);

      if (allocErr) throw allocErr;

      setMessage(`✅ Marked paid: ${inv.invoice_no} (${currencyFormatter.format(balanceDue)})`);
      await load();
    } catch (err) {
      setMessage(`Error marking paid: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const savePartialCustomerPayment = async (inv) => {
    setMessage('');
    if (isSaving) return;

    const amount = parseFloat(partialAmount || '0');
    if (!amount || amount <= 0) return setMessage('Enter a partial payment amount > 0.');

    const balanceDue = Number(inv.balance_due || 0);
    const applyAmount = Math.min(amount, balanceDue);

    setIsSaving(true);
    try {
      const { data: paymentRow, error: payErr } = await supabaseClient
        .schema('app')
        .from('payments')
        .insert([
          {
            party_type: 'customer',
            customer_id: inv.customer_id,
            supplier_id: null,
            direction: 'in',
            amount,
            payment_date: new Date().toISOString(),
            method: 'cash',
            reference: null,
            note: `Partial payment for ${inv.invoice_no}`,
            source: 'partial_payment',
          },
        ])
        .select('id')
        .single();

      if (payErr) throw payErr;

      const { error: allocErr } = await supabaseClient.schema('app').from('payment_allocations').insert([
        {
          payment_id: paymentRow.id,
          invoice_type: 'sale',
          sales_invoice_id: inv.id,
          purchase_invoice_id: null,
          amount_applied: applyAmount,
        },
      ]);

      if (allocErr) throw allocErr;

      const remainder = amount - applyAmount;
      if (remainder > 0) {
        setMessage(`✅ Saved. Applied ${currencyFormatter.format(applyAmount)}; extra ${currencyFormatter.format(remainder)} remains as customer credit.`);
      } else {
        setMessage(`✅ Saved partial payment: ${inv.invoice_no}`);
      }

      setPartialInvoiceId(null);
      setPartialAmount('');
      await load();
    } catch (err) {
      setMessage(`Error saving partial payment: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const printCustomerOutstanding = async (customer_id) => {
    setMessage('');
    const customerName = customerNameById.get(customer_id) || 'Customer';

    const customerInvoices = salesBalances.filter((x) => x.customer_id === customer_id);
    if (customerInvoices.length === 0) return setMessage('No outstanding invoices for this customer.');

    const invoiceIds = customerInvoices.map((x) => x.id);

    const { data: lines, error } = await supabaseClient
      .schema('app')
      .from('sales_invoice_lines')
      .select('invoice_id,packs_qty,unit_price,line_total,bundles(name)')
      .in('invoice_id', invoiceIds);

    if (error) return setMessage(`Error loading invoice lines for receipt: ${error.message}`);

    const linesByInv = new Map();
    for (const l of lines || []) {
      if (!linesByInv.has(l.invoice_id)) linesByInv.set(l.invoice_id, []);
      linesByInv.get(l.invoice_id).push({
        bundle_name: l.bundles?.name || '',
        packs_qty: Number(l.packs_qty || 0),
        unit_price: Number(l.unit_price || 0),
        line_total: Number(l.line_total || (Number(l.packs_qty || 0) * Number(l.unit_price || 0))),
      });
    }

    const payload = customerInvoices.map((inv) => ({
      invoice_no: inv.invoice_no,
      invoice_date: inv.invoice_date,
      total: Number(inv.total || 0),
      balance_due: Number(inv.balance_due || 0),
      lines: linesByInv.get(inv.id) || [],
    }));

    generateCustomerOutstandingReceipt(customerName, payload);
    setMessage(`✅ Printed outstanding statement for ${customerName}`);
  };

  // ===== SUPPLIER ACTIONS =====

  const markPurchaseInvoicePaid = async (inv) => {
    setMessage('');
    if (isSaving) return;

    const balanceDue = Number(inv.balance_due || 0);
    if (balanceDue <= 0) return;

    setIsSaving(true);
    try {
      const { data: paymentRow, error: payErr } = await supabaseClient
        .schema('app')
        .from('payments')
        .insert([
          {
            party_type: 'supplier',
            customer_id: null,
            supplier_id: inv.supplier_id,
            direction: 'out',
            amount: balanceDue,
            payment_date: new Date().toISOString(),
            method: 'cash',
            reference: null,
            note: `Mark paid: ${inv.invoice_no}`,
            source: 'mark_paid_button',
          },
        ])
        .select('id')
        .single();

      if (payErr) throw payErr;

      const { error: allocErr } = await supabaseClient.schema('app').from('payment_allocations').insert([
        {
          payment_id: paymentRow.id,
          invoice_type: 'purchase',
          sales_invoice_id: null,
          purchase_invoice_id: inv.id,
          amount_applied: balanceDue,
        },
      ]);

      if (allocErr) throw allocErr;

      setMessage(`✅ Supplier invoice paid: ${inv.invoice_no} (${currencyFormatter.format(balanceDue)})`);
      await load();
    } catch (err) {
      setMessage(`Error paying supplier invoice: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const savePartialSupplierPayment = async (inv) => {
    setMessage('');
    if (isSaving) return;

    const amount = parseFloat(partialPurchaseAmount || '0');
    if (!amount || amount <= 0) return setMessage('Enter a partial payment amount > 0.');

    const balanceDue = Number(inv.balance_due || 0);
    const applyAmount = Math.min(amount, balanceDue);

    setIsSaving(true);
    try {
      const { data: paymentRow, error: payErr } = await supabaseClient
        .schema('app')
        .from('payments')
        .insert([
          {
            party_type: 'supplier',
            customer_id: null,
            supplier_id: inv.supplier_id,
            direction: 'out',
            amount,
            payment_date: new Date().toISOString(),
            method: 'cash',
            reference: null,
            note: `Partial supplier payment for ${inv.invoice_no}`,
            source: 'partial_payment',
          },
        ])
        .select('id')
        .single();

      if (payErr) throw payErr;

      const { error: allocErr } = await supabaseClient.schema('app').from('payment_allocations').insert([
        {
          payment_id: paymentRow.id,
          invoice_type: 'purchase',
          sales_invoice_id: null,
          purchase_invoice_id: inv.id,
          amount_applied: applyAmount,
        },
      ]);

      if (allocErr) throw allocErr;

      const remainder = amount - applyAmount;
      if (remainder > 0) {
        setMessage(`✅ Saved. Applied ${currencyFormatter.format(applyAmount)}; extra ${currencyFormatter.format(remainder)} remains as supplier advance.`);
      } else {
        setMessage(`✅ Saved partial supplier payment: ${inv.invoice_no}`);
      }

      setPartialPurchaseInvoiceId(null);
      setPartialPurchaseAmount('');
      await load();
    } catch (err) {
      setMessage(`Error saving supplier partial payment: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Option A: print ONLY outstanding invoices for supplier
  const printSupplierOutstanding = async (supplier_id) => {
    setMessage('');
    const supplierName = supplierNameById.get(supplier_id) || 'Supplier';

    const supplierInvoices = purchaseBalances.filter((x) => x.supplier_id === supplier_id);
    if (supplierInvoices.length === 0) return setMessage('No outstanding invoices for this supplier.');

    const invoiceIds = supplierInvoices.map((x) => x.id);

    const { data: lines, error } = await supabaseClient
      .schema('app')
      .from('purchase_invoice_lines')
      .select('invoice_id,bundles_qty,unit_cost_per_bundle,line_total,bundles(name)')
      .in('invoice_id', invoiceIds);

    if (error) return setMessage(`Error loading invoice lines: ${error.message}`);

    const linesByInv = new Map();
    for (const l of lines || []) {
      if (!linesByInv.has(l.invoice_id)) linesByInv.set(l.invoice_id, []);
      linesByInv.get(l.invoice_id).push({
        bundle_name: l.bundles?.name || '',
        bundles_qty: Number(l.bundles_qty || 0),
        unit_cost_per_bundle: Number(l.unit_cost_per_bundle || 0),
        line_total: Number(l.line_total || 0),
      });
    }

    const payload = supplierInvoices.map((inv) => ({
      invoice_no: inv.invoice_no,
      invoice_date: inv.invoice_date,
      total: Number(inv.total || 0),
      balance_due: Number(inv.balance_due || 0),
      lines: linesByInv.get(inv.id) || [],
    }));

    generateSupplierOutstandingReceipt(supplierName, payload);
    setMessage(`✅ Printed outstanding statement for ${supplierName}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
          <CreditCard className="h-6 w-6" /> Pending Payments
        </h2>
        <div className="flex p-1 bg-muted rounded-lg">
          <button
            className={cn("px-4 py-1.5 text-sm font-medium rounded-md transition-all", activeTab === 'customers' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground")}
            onClick={() => setActiveTab('customers')}
          >
            Customers (Sales)
          </button>
          <button
            className={cn("px-4 py-1.5 text-sm font-medium rounded-md transition-all", activeTab === 'suppliers' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground")}
            onClick={() => setActiveTab('suppliers')}
          >
            Suppliers (Purchase)
          </button>
          <button
            className={cn("px-4 py-1.5 text-sm font-medium rounded-md transition-all", activeTab === 'credits' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground")}
            onClick={() => setActiveTab('credits')}
          >
            Credits & Advances
          </button>
        </div>
      </div>

      {message && (
        <div className={cn("p-4 rounded-md text-sm font-medium border", message.startsWith('Error') ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20")}>
          {message}
        </div>
      )}

      {/* CUSTOMER PENDING */}
      {activeTab === 'customers' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" /> Customer Pending Sales
            </CardTitle>
          </CardHeader>
          <CardContent>
            {salesPaged.totalCount === 0 ? (
              <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">No outstanding sales invoices.</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between bg-muted/30 p-2 rounded-lg border text-sm">
                  <span className="text-muted-foreground ml-2">
                    Showing <strong>{salesPaged.items.length}</strong> of <strong>{salesPaged.totalCount}</strong> outstanding
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={salesPaged.safePage <= 1}>
                      Previous
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(salesPaged.totalPages, p + 1))} disabled={salesPaged.safePage >= salesPaged.totalPages}>
                      Next
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  {customersOnPage.map((cg) => {
                    const cname = customerNameById.get(cg.customer_id) || cg.customer_id;
                    const expanded = expandedCustomerId === cg.customer_id;

                    return (
                      <div key={cg.customer_id} className="border rounded-lg overflow-hidden transition-all bg-card">
                        <div
                          className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 cursor-pointer hover:bg-muted/50"
                        >
                          <div className="flex-1" onClick={() => setExpandedCustomerId(expanded ? null : cg.customer_id)}>
                            <div className="flex items-center gap-2">
                              {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                              <h3 className="font-semibold text-lg">{cname}</h3>
                            </div>
                            <div className="text-sm text-muted-foreground ml-6 mt-1 flex gap-4">
                              <span>Records: {cg.count}</span>
                              <span>Due: <span className="font-mono text-foreground font-medium">{currencyFormatter.format(cg.balanceSum)}</span></span>
                            </div>
                          </div>
                          <Button variant="secondary" size="sm" onClick={() => printCustomerOutstanding(cg.customer_id)} disabled={isSaving}>
                            <Printer className="h-4 w-4 mr-2" /> Outstanding Statement
                          </Button>
                        </div>

                        {expanded && (
                          <div className="border-t bg-muted/10 p-0 overflow-x-auto animate-in slide-in-from-top-1">
                            <table className="w-full text-sm caption-bottom">
                              <thead className="bg-muted/50 border-b">
                                <tr>
                                  <th className="h-10 px-4 text-left font-medium text-muted-foreground">Date</th>
                                  <th className="h-10 px-4 text-left font-medium text-muted-foreground">Invoice</th>
                                  <th className="h-10 px-4 text-right font-medium text-muted-foreground">Total</th>
                                  <th className="h-10 px-4 text-right font-medium text-muted-foreground">Paid</th>
                                  <th className="h-10 px-4 text-right font-medium text-muted-foreground">Balance</th>
                                  <th className="h-10 px-4 text-left font-medium text-muted-foreground pl-8">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cg.invoices.map((inv) => (
                                  <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                                    <td className="p-4 whitespace-nowrap">{new Date(inv.invoice_date).toLocaleDateString('en-LK')}</td>
                                    <td className="p-4 font-mono">{inv.invoice_no}</td>
                                    <td className="p-4 text-right tabular-nums">{currencyFormatter.format(inv.total)}</td>
                                    <td className="p-4 text-right tabular-nums text-muted-foreground">{currencyFormatter.format(inv.paid_applied)}</td>
                                    <td className="p-4 text-right tabular-nums font-bold text-destructive">{currencyFormatter.format(inv.balance_due)}</td>
                                    <td className="p-4 pl-8">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <Button size="sm" variant="default" className="h-8" onClick={() => markSalesInvoicePaid(inv)} disabled={isSaving}>
                                          <Check className="h-3.5 w-3.5 mr-1" /> Mark Paid
                                        </Button>

                                        {partialInvoiceId === inv.id ? (
                                          <div className="flex items-center gap-2 bg-background border rounded-md p-1 shadow-sm">
                                            <Input
                                              type="number" className="h-7 w-24 text-xs"
                                              placeholder="Amount"
                                              value={partialAmount}
                                              onChange={(e) => setPartialAmount(e.target.value)}
                                              autoFocus
                                            />
                                            <Button size="icon" className="h-7 w-7" onClick={() => savePartialCustomerPayment(inv)} disabled={isSaving}><Check className="h-3 w-3" /></Button>
                                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setPartialInvoiceId(null); setPartialAmount(''); }}><ChevronDown className="h-3 w-3 rotate-180" /></Button>
                                          </div>
                                        ) : (
                                          <Button size="sm" variant="outline" className="h-8" onClick={() => { setPartialInvoiceId(inv.id); setPartialAmount(''); }} disabled={isSaving}>
                                            Partial
                                          </Button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* SUPPLIER PENDING */}
      {activeTab === 'suppliers' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" /> Supplier Pending Borrowings
            </CardTitle>
          </CardHeader>
          <CardContent>
            {suppliersGrouped.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">No outstanding purchase invoices.</div>
            ) : (
              <div className="space-y-3">
                {suppliersGrouped.map((sg) => {
                  const sname = supplierNameById.get(sg.supplier_id) || sg.supplier_id;
                  const expanded = expandedSupplierId === sg.supplier_id;

                  return (
                    <div key={sg.supplier_id} className="border rounded-lg overflow-hidden transition-all bg-card">
                      <div
                        className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 cursor-pointer hover:bg-muted/50"
                      >
                        <div className="flex-1" onClick={() => setExpandedSupplierId(expanded ? null : sg.supplier_id)}>
                          <div className="flex items-center gap-2">
                            {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                            <h3 className="font-semibold text-lg">{sname}</h3>
                          </div>
                          <div className="text-sm text-muted-foreground ml-6 mt-1 flex gap-4">
                            <span>Records: {sg.count}</span>
                            <span>Due: <span className="font-mono text-foreground font-medium">{currencyFormatter.format(sg.balanceSum)}</span></span>
                          </div>
                        </div>
                        <Button variant="secondary" size="sm" onClick={() => printSupplierOutstanding(sg.supplier_id)} disabled={isSaving}>
                          <Printer className="h-4 w-4 mr-2" /> Outstanding Statement
                        </Button>
                      </div>

                      {expanded && (
                        <div className="border-t bg-muted/10 p-0 overflow-x-auto animate-in slide-in-from-top-1">
                          <table className="w-full text-sm caption-bottom">
                            <thead className="bg-muted/50 border-b">
                              <tr>
                                <th className="h-10 px-4 text-left font-medium text-muted-foreground">Date</th>
                                <th className="h-10 px-4 text-left font-medium text-muted-foreground">Invoice</th>
                                <th className="h-10 px-4 text-right font-medium text-muted-foreground">Total</th>
                                <th className="h-10 px-4 text-right font-medium text-muted-foreground">Paid</th>
                                <th className="h-10 px-4 text-right font-medium text-muted-foreground">Balance</th>
                                <th className="h-10 px-4 text-left font-medium text-muted-foreground pl-8">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sg.invoices.map((inv) => (
                                <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                                  <td className="p-4 whitespace-nowrap">{new Date(inv.invoice_date).toLocaleDateString('en-LK')}</td>
                                  <td className="p-4 font-mono">{inv.invoice_no}</td>
                                  <td className="p-4 text-right tabular-nums">{currencyFormatter.format(inv.total)}</td>
                                  <td className="p-4 text-right tabular-nums text-muted-foreground">{currencyFormatter.format(inv.paid_applied)}</td>
                                  <td className="p-4 text-right tabular-nums font-bold text-destructive">{currencyFormatter.format(inv.balance_due)}</td>
                                  <td className="p-4 pl-8">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <Button size="sm" variant="default" className="h-8" onClick={() => markPurchaseInvoicePaid(inv)} disabled={isSaving}>
                                        <Check className="h-3.5 w-3.5 mr-1" /> Mark Paid
                                      </Button>

                                      {partialPurchaseInvoiceId === inv.id ? (
                                        <div className="flex items-center gap-2 bg-background border rounded-md p-1 shadow-sm">
                                          <Input
                                            type="number" className="h-7 w-24 text-xs"
                                            placeholder="Amount"
                                            value={partialPurchaseAmount}
                                            onChange={(e) => setPartialPurchaseAmount(e.target.value)}
                                            autoFocus
                                          />
                                          <Button size="icon" className="h-7 w-7" onClick={() => savePartialSupplierPayment(inv)} disabled={isSaving}><Check className="h-3 w-3" /></Button>
                                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setPartialPurchaseInvoiceId(null); setPartialPurchaseAmount(''); }}><ChevronDown className="h-3 w-3 rotate-180" /></Button>
                                        </div>
                                      ) : (
                                        <Button size="sm" variant="outline" className="h-8" onClick={() => { setPartialPurchaseInvoiceId(inv.id); setPartialPurchaseAmount(''); }} disabled={isSaving}>
                                          Partial
                                        </Button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* CREDITS & ADVANCES */}
      {activeTab === 'credits' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Customer Credits</CardTitle></CardHeader>
            <CardContent>
              {customerCredit.length === 0 ? (
                <div className="text-sm text-muted-foreground">No customer credits found.</div>
              ) : (
                <div className="rounded-md border">
                  <table className="w-full text-sm">
                    <tbody>
                      {customerCredit.map(r => (
                        <tr key={r.customer_id} className="border-b last:border-0 hover:bg-muted/50">
                          <td className="p-3 font-medium">{r.name}</td>
                          <td className="p-3 text-right text-emerald-600 font-bold">{currencyFormatter.format(r.credit_balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Supplier Advances</CardTitle></CardHeader>
            <CardContent>
              {supplierAdvance.length === 0 ? (
                <div className="text-sm text-muted-foreground">No supplier advances found.</div>
              ) : (
                <div className="rounded-md border">
                  <table className="w-full text-sm">
                    <tbody>
                      {supplierAdvance.map(r => (
                        <tr key={r.supplier_id} className="border-b last:border-0 hover:bg-muted/50">
                          <td className="p-3 font-medium">{r.name}</td>
                          <td className="p-3 text-right text-emerald-600 font-bold">{currencyFormatter.format(r.advance_balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
