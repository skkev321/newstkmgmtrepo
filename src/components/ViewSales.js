import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { currencyFormatter } from './formatters';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { TrendingUp, User, Package } from 'lucide-react';
import { cn } from '../lib/utils';

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
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-2">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" /> Sales History
          </CardTitle>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <div className="relative">
              <User className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <select
                className="h-9 w-full sm:w-[200px] rounded-md border border-input bg-transparent pl-9 pr-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
              >
                <option value="">All Customers</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="relative">
              <Package className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <select
                className="h-9 w-full sm:w-[200px] rounded-md border border-input bg-transparent pl-9 pr-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={selectedBundleId}
                onChange={(e) => setSelectedBundleId(e.target.value)}
              >
                <option value="">All Bundles</option>
                {bundleTypes.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {message && (
            <div className="p-3 mb-4 rounded-md bg-destructive/10 text-destructive text-sm font-medium">
              {message}
            </div>
          )}

          <div className="rounded-md border overflow-x-auto">
            <table className="w-full caption-bottom text-sm">
              <thead>
                <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-[180px]">Date/Time</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Invoice</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Bundle</th>
                  <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Packs</th>
                  <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Price</th>
                  <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Cost</th>
                  <th className="h-12 px-4 text-center align-middle font-medium text-muted-foreground">Status</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Customer</th>
                  <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Total</th>
                  <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Profit</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan="10" className="p-4 text-center text-muted-foreground">No sales records found.</td></tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                      <td className="p-4 text-muted-foreground font-mono text-xs">
                        {new Date(r.invoice_date).toLocaleString('en-LK', {
                          year: 'numeric', month: 'numeric', day: 'numeric',
                          hour: '2-digit', minute: '2-digit'
                        })}
                      </td>
                      <td className="p-4 font-mono text-xs">{r.invoice_no}</td>
                      <td className="p-4 font-medium">{r.bundle_name}</td>
                      <td className="p-4 text-right">{r.packs_qty}</td>
                      <td className="p-4 text-right text-muted-foreground">{currencyFormatter.format(r.unit_price)}</td>
                      <td className="p-4 text-right text-muted-foreground">{currencyFormatter.format(r.unit_cost)}</td>
                      <td className="p-4 text-center">
                        <span className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
                          r.payment_status === 'paid' ? "bg-emerald-500/10 text-emerald-600" : "bg-yellow-500/10 text-yellow-600"
                        )}>
                          {r.payment_status}
                        </span>
                      </td>
                      <td className="p-4 text-sm">{customerNameById.get(r.customer_id) || '—'}</td>
                      <td className="p-4 text-right font-medium">{currencyFormatter.format(r.line_total)}</td>
                      <td className={cn("p-4 text-right font-medium", r.profit >= 0 ? "text-emerald-600" : "text-destructive")}>
                        {currencyFormatter.format(r.profit)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
