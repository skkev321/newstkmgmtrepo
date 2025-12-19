import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { currencyFormatter } from './formatters';

export default function ViewSales({ supabaseClient }) {
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedBundleId, setSelectedBundleId] = useState('');

  const [bundleTypes, setBundleTypes] = useState([]);
  const [customers, setCustomers] = useState([]);

  const customerNameById = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);

  const loadFilters = useCallback(async () => {
    const [{ data: b, error: bErr }, { data: c, error: cErr }] = await Promise.all([
      supabaseClient.schema('app').from('bundles').select('id,name').order('name'),
      supabaseClient.schema('app').from('customers').select('id,name').order('name'),
    ]);

    if (bErr || cErr) {
      setMessage(`Error loading filters: ${(bErr || cErr).message}`);
      return;
    }

    setBundleTypes(b || []);
    setCustomers(c || []);
  }, [supabaseClient]);

  const loadSalesLines = useCallback(async () => {
    setMessage('');

    // ✅ Correct column names: invoice_id, unit_cost
    let query = supabaseClient
      .schema('app')
      .from('sales_invoice_lines')
      .select(
        `
        id,
        invoice_id,
        bundle_id,
        packs_qty,
        unit_price,
        unit_cost,
        line_total,
        bundles ( name ),
        sales_invoices!inner (
          id,
          invoice_no,
          invoice_date,
          customer_id,
          total
        )
      `
      )
      .order('invoice_date', { foreignTable: 'sales_invoices', ascending: false });

    if (selectedBundleId) query = query.eq('bundle_id', selectedBundleId);
    if (selectedCustomerId) query = query.eq('sales_invoices.customer_id', selectedCustomerId);

    const { data, error } = await query;

    if (error) {
      setMessage(`Error fetching sales records: ${error.message}`);
      setRows([]);
      return;
    }

    // Load invoice balances to show payment status
    const invoiceIds = [...new Set((data || []).map((r) => r.sales_invoices?.id).filter(Boolean))];

    let balanceByInvoiceId = new Map();
    if (invoiceIds.length > 0) {
      const { data: balances, error: balErr } = await supabaseClient
        .schema('app')
        .from('v_sales_invoice_balance')
        .select('id,balance_due')
        .in('id', invoiceIds);

      if (!balErr && balances) {
        balanceByInvoiceId = new Map(balances.map((b) => [b.id, Number(b.balance_due || 0)]));
      }
    }

    const result = (data || [])
      .map((r) => {
        const inv = r.sales_invoices;
        const invoiceBalance = inv?.id ? (balanceByInvoiceId.get(inv.id) ?? 0) : 0;

        const revenue = Number(r.packs_qty || 0) * Number(r.unit_price || 0);
        const cogs = Number(r.packs_qty || 0) * Number(r.unit_cost || 0);
        const profit = revenue - cogs;

        return {
          id: r.id,
          invoice_no: inv?.invoice_no || '',
          invoice_date: inv?.invoice_date || null,
          customer_id: inv?.customer_id || null,
          bundle_name: r.bundles?.name || '',
          packs_qty: Number(r.packs_qty || 0),
          unit_price: Number(r.unit_price || 0),
          unit_cost: Number(r.unit_cost || 0),
          payment_status: invoiceBalance > 0 ? 'pending' : 'paid',
          line_total: Number(r.line_total || revenue),
          profit,
        };
      })
      .filter((x) => x.invoice_date);

    setRows(result);
  }, [supabaseClient, selectedBundleId, selectedCustomerId]);

  useEffect(() => {
    loadFilters();
  }, [loadFilters]);

  useEffect(() => {
    loadSalesLines();
  }, [loadSalesLines]);

  return (
    <div className="card">
      <h2>📈 Sales History</h2>
      {message && <p className="message">{message}</p>}

      <div className="filters form-grid">
        <div className="form-group">
          <label>Filter by Customer:</label>
          <select value={selectedCustomerId} onChange={(e) => setSelectedCustomerId(e.target.value)}>
            <option value="">All Customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Filter by Bundle:</label>
          <select value={selectedBundleId} onChange={(e) => setSelectedBundleId(e.target.value)}>
            <option value="">All Bundles</option>
            {bundleTypes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="responsive-table">
        <table className="moderntable">
          <thead>
            <tr>
              <th>Date/Time</th>
              <th>Invoice</th>
              <th>Bundle</th>
              <th>Packs</th>
              <th>Price/Pack</th>
              <th>Cost/Pack</th>
              <th>Payment</th>
              <th>Customer</th>
              <th>Line Total</th>
              <th>Profit</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan="10">No sales records found.</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.invoice_date).toLocaleString('en-LK', { timeZone: 'Asia/Colombo' })}</td>
                  <td>{r.invoice_no}</td>
                  <td>{r.bundle_name}</td>
                  <td>{r.packs_qty}</td>
                  <td>{currencyFormatter.format(r.unit_price)}</td>
                  <td>{currencyFormatter.format(r.unit_cost)}</td>
                  <td>{r.payment_status}</td>
                  <td>{customerNameById.get(r.customer_id) || '—'}</td>
                  <td>{currencyFormatter.format(r.line_total)}</td>
                  <td>{currencyFormatter.format(r.profit)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
