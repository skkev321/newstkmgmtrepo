import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { generateCustomerOutstandingReceipt, generateSupplierOutstandingReceipt } from './ReceiptModal';

export default function PendingPayments({ supabaseClient }) {
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

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

      setMessage(`✅ Marked paid: ${inv.invoice_no} (LKR ${balanceDue.toFixed(2)})`);
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
        setMessage(`✅ Saved. Applied LKR ${applyAmount.toFixed(2)}; extra LKR ${remainder.toFixed(2)} remains as customer credit.`);
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

      setMessage(`✅ Supplier invoice paid: ${inv.invoice_no} (LKR ${balanceDue.toFixed(2)})`);
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
        setMessage(`✅ Saved. Applied LKR ${applyAmount.toFixed(2)}; extra LKR ${remainder.toFixed(2)} remains as supplier advance.`);
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
    <div className="card">
      <h2>💳 Pending Payments</h2>
      {message && <p className={`message ${message.startsWith('Error') ? 'error' : ''}`}>{message}</p>}

      <div className="split-container">
        {/* CUSTOMER PENDING */}
        <div className="column">
          <h3>👤 Customer Pending Sales</h3>

          {salesPaged.totalCount === 0 ? (
            <div className="loading">No outstanding sales invoices.</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ color: '#64748b' }}>
                  Showing <strong>{salesPaged.items.length}</strong> of <strong>{salesPaged.totalCount}</strong> outstanding invoices
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={salesPaged.safePage <= 1}
                  >
                    Prev
                  </button>

                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {Array.from({ length: salesPaged.totalPages }, (_, i) => i + 1).map((pno) => (
                      <button
                        key={pno}
                        type="button"
                        className={`button ${pno === salesPaged.safePage ? 'primary' : 'secondary'}`}
                        onClick={() => setPage(pno)}
                        style={{ padding: '0.35rem 0.65rem' }}
                      >
                        {pno}
                      </button>
                    ))}
                  </div>

                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setPage((p) => Math.min(salesPaged.totalPages, p + 1))}
                    disabled={salesPaged.safePage >= salesPaged.totalPages}
                  >
                    Next
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                {customersOnPage.map((cg) => {
                  const cname = customerNameById.get(cg.customer_id) || cg.customer_id;
                  const expanded = expandedCustomerId === cg.customer_id;

                  return (
                    <div key={cg.customer_id} className="payment-item" style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ cursor: 'pointer' }} onClick={() => setExpandedCustomerId(expanded ? null : cg.customer_id)}>
                          <strong>{cname}</strong>
                          <div style={{ color: '#64748b', marginTop: 4 }}>
                            Invoices on this page: {cg.count} | Due (on this page): LKR {cg.balanceSum.toFixed(2)}
                          </div>
                          <small style={{ color: '#64748b' }}>{expanded ? 'Click to collapse' : 'Click to expand invoices'}</small>
                        </div>

                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => printCustomerOutstanding(cg.customer_id)}
                            disabled={isSaving}
                            title="Print customer outstanding statement"
                          >
                            🖨️ Print Outstanding
                          </button>
                        </div>
                      </div>

                      {expanded && (
                        <div style={{ marginTop: 10 }}>
                          <div className="responsive-table">
                            <table className="moderntable">
                              <thead>
                                <tr>
                                  <th>Date</th>
                                  <th>Invoice</th>
                                  <th>Total</th>
                                  <th>Paid</th>
                                  <th>Balance</th>
                                  <th style={{ width: 240 }}>Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cg.invoices.map((inv) => (
                                  <tr key={inv.id}>
                                    <td>{new Date(inv.invoice_date).toLocaleString('en-LK', { timeZone: 'Asia/Colombo' })}</td>
                                    <td>{inv.invoice_no}</td>
                                    <td>{Number(inv.total || 0).toFixed(2)}</td>
                                    <td>{Number(inv.paid_applied || 0).toFixed(2)}</td>
                                    <td><strong>{Number(inv.balance_due || 0).toFixed(2)}</strong></td>
                                    <td>
                                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                        <button
                                          type="button"
                                          className="button primary"
                                          onClick={() => markSalesInvoicePaid(inv)}
                                          disabled={isSaving}
                                        >
                                          Mark Paid (Cash)
                                        </button>

                                        <button
                                          type="button"
                                          className="button secondary"
                                          onClick={() => {
                                            setPartialInvoiceId(inv.id);
                                            setPartialAmount('');
                                          }}
                                          disabled={isSaving}
                                        >
                                          Partial
                                        </button>
                                      </div>

                                      {partialInvoiceId === inv.id && (
                                        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                          <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            placeholder="Amount"
                                            value={partialAmount}
                                            onChange={(e) => setPartialAmount(e.target.value)}
                                            style={{ width: 130 }}
                                          />
                                          <button
                                            type="button"
                                            className="button primary"
                                            onClick={() => savePartialCustomerPayment(inv)}
                                            disabled={isSaving}
                                          >
                                            Save
                                          </button>
                                          <button
                                            type="button"
                                            className="button secondary"
                                            onClick={() => {
                                              setPartialInvoiceId(null);
                                              setPartialAmount('');
                                            }}
                                            disabled={isSaving}
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <small style={{ color: '#64748b' }}>
                            Mark Paid records a real payment for the exact balance (cash) and allocates it to the invoice.
                          </small>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* SUPPLIER PENDING */}
        <div className="column">
          <h3>🏭 Supplier Pending Borrowings</h3>

          {suppliersGrouped.length === 0 ? (
            <div className="loading">No outstanding purchase invoices.</div>
          ) : (
            <div style={{ marginTop: 12 }}>
              {suppliersGrouped.map((sg) => {
                const sname = supplierNameById.get(sg.supplier_id) || sg.supplier_id;
                const expanded = expandedSupplierId === sg.supplier_id;

                return (
                  <div key={sg.supplier_id} className="payment-item" style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ cursor: 'pointer' }} onClick={() => setExpandedSupplierId(expanded ? null : sg.supplier_id)}>
                        <strong>{sname}</strong>
                        <div style={{ color: '#64748b', marginTop: 4 }}>
                          Outstanding invoices: {sg.count} | Total due: LKR {sg.balanceSum.toFixed(2)}
                        </div>
                        <small style={{ color: '#64748b' }}>{expanded ? 'Click to collapse' : 'Click to expand invoices'}</small>
                      </div>

                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => printSupplierOutstanding(sg.supplier_id)}
                          disabled={isSaving}
                          title="Print supplier outstanding statement"
                        >
                          🖨️ Print Outstanding
                        </button>
                      </div>
                    </div>

                    {expanded && (
                      <div style={{ marginTop: 10 }}>
                        <div className="responsive-table">
                          <table className="moderntable">
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Invoice</th>
                                <th>Total</th>
                                <th>Paid</th>
                                <th>Balance</th>
                                <th style={{ width: 260 }}>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sg.invoices.map((inv) => (
                                <tr key={inv.id}>
                                  <td>{new Date(inv.invoice_date).toLocaleString('en-LK', { timeZone: 'Asia/Colombo' })}</td>
                                  <td>{inv.invoice_no}</td>
                                  <td>{Number(inv.total || 0).toFixed(2)}</td>
                                  <td>{Number(inv.paid_applied || 0).toFixed(2)}</td>
                                  <td><strong>{Number(inv.balance_due || 0).toFixed(2)}</strong></td>
                                  <td>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                      <button
                                        type="button"
                                        className="button primary"
                                        onClick={() => markPurchaseInvoicePaid(inv)}
                                        disabled={isSaving}
                                      >
                                        Mark Paid (Cash)
                                      </button>

                                      <button
                                        type="button"
                                        className="button secondary"
                                        onClick={() => {
                                          setPartialPurchaseInvoiceId(inv.id);
                                          setPartialPurchaseAmount('');
                                        }}
                                        disabled={isSaving}
                                      >
                                        Partial
                                      </button>
                                    </div>

                                    {partialPurchaseInvoiceId === inv.id && (
                                      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          placeholder="Amount"
                                          value={partialPurchaseAmount}
                                          onChange={(e) => setPartialPurchaseAmount(e.target.value)}
                                          style={{ width: 130 }}
                                        />
                                        <button
                                          type="button"
                                          className="button primary"
                                          onClick={() => savePartialSupplierPayment(inv)}
                                          disabled={isSaving}
                                        >
                                          Save
                                        </button>
                                        <button
                                          type="button"
                                          className="button secondary"
                                          onClick={() => {
                                            setPartialPurchaseInvoiceId(null);
                                            setPartialPurchaseAmount('');
                                          }}
                                          disabled={isSaving}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <small style={{ color: '#64748b' }}>
                          Mark Paid records a real supplier payment (cash) and allocates it to the purchase invoice. Extra amount becomes supplier advance.
                        </small>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <hr />

      {/* Credits at the end (low priority) */}
      <h3>Customer Credits (low priority)</h3>
      <div className="responsive-table">
        <table className="moderntable">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Credit Balance</th>
            </tr>
          </thead>
          <tbody>
            {customerCredit.length === 0 ? (
              <tr><td colSpan="2">No customer credits.</td></tr>
            ) : (
              customerCredit.map((r) => (
                <tr key={r.customer_id}>
                  <td>{r.name}</td>
                  <td>{Number(r.credit_balance || 0).toFixed(2)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 18 }}>Supplier Advances (info)</h3>
      <div className="responsive-table">
        <table className="moderntable">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Advance Balance</th>
            </tr>
          </thead>
          <tbody>
            {supplierAdvance.length === 0 ? (
              <tr><td colSpan="2">No supplier advances.</td></tr>
            ) : (
              supplierAdvance.map((r) => (
                <tr key={r.supplier_id}>
                  <td>{r.name}</td>
                  <td>{Number(r.advance_balance || 0).toFixed(2)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
