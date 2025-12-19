import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { currencyFormatter, percentageFormatter } from './formatters';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import moment from 'moment';

export default function ViewAnalytics({ supabaseClient }) {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [range, setRange] = useState('monthly');

  const getStartDate = useMemo(() => {
    const now = moment();
    if (range === 'monthly') return now.clone().startOf('month');
    if (range === 'last3months') return now.clone().subtract(3, 'months');
    if (range === 'ytd') return now.clone().startOf('year');
    return now.clone().startOf('month');
  }, [range]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setMessage('');

    try {
      const startDate = getStartDate;

      // Sales invoices
      const { data: salesInvoices, error: siErr } = await supabaseClient
        .schema('app')
        .from('sales_invoices')
        .select('id,invoice_date,total')
        .gte('invoice_date', startDate.toISOString());

      if (siErr) throw siErr;

      const invoiceIds = (salesInvoices || []).map((x) => x.id);

      // Sales lines (for profit + bundle stats)
      const { data: salesLines, error: slErr } = await supabaseClient
        .schema('app')
        .from('sales_invoice_lines')
        .select('invoice_id,bundle_id,packs_qty,unit_price,unit_cost,bundles(name)')
        .in('invoice_id', invoiceIds.length ? invoiceIds : ['00000000-0000-0000-0000-000000000000']);

      if (slErr) throw slErr;

      // Receivables
      let receivables = 0;
      if (invoiceIds.length > 0) {
        const { data: sBal, error: sbErr } = await supabaseClient
          .schema('app')
          .from('v_sales_invoice_balance')
          .select('id,balance_due')
          .in('id', invoiceIds);

        if (sbErr) throw sbErr;
        receivables = (sBal || []).reduce((sum, r) => sum + Number(r.balance_due || 0), 0);
      }

      // Payables
      const { data: purchaseInvoices, error: piErr } = await supabaseClient
        .schema('app')
        .from('purchase_invoices')
        .select('id,invoice_date,total')
        .gte('invoice_date', startDate.toISOString());

      if (piErr) throw piErr;

      const purchaseIds = (purchaseInvoices || []).map((x) => x.id);

      let payables = 0;
      if (purchaseIds.length > 0) {
        const { data: pBal, error: pbErr } = await supabaseClient
          .schema('app')
          .from('v_purchase_invoice_balance')
          .select('id,balance_due')
          .in('id', purchaseIds);

        if (pbErr) throw pbErr;
        payables = (pBal || []).reduce((sum, r) => sum + Number(r.balance_due || 0), 0);
      }

      // Stock
      const { data: stockRows, error: stErr } = await supabaseClient
        .schema('app')
        .from('v_current_stock')
        .select('bundle_id,name,packs_in_stock')
        .order('name');

      if (stErr) throw stErr;

      // Totals
      const totalRevenue = (salesInvoices || []).reduce((sum, inv) => sum + Number(inv.total || 0), 0);

      const totalCost = (salesLines || []).reduce(
        (sum, l) => sum + Number(l.packs_qty || 0) * Number(l.unit_cost || 0),
        0
      );

      const totalProfit = totalRevenue - totalCost;
      const grossMargin = totalRevenue ? totalProfit / totalRevenue : 0;

      // Trends (monthly + weekly) from invoice totals
      const monthly = {};
      const weekly = {};

      for (const inv of salesInvoices || []) {
        const m = moment(inv.invoice_date).format('YYYY-MM');
        monthly[m] = (monthly[m] || 0) + Number(inv.total || 0);

        const w = moment(inv.invoice_date).startOf('isoWeek').format('YYYY-[W]WW');
        weekly[w] = (weekly[w] || 0) + Number(inv.total || 0);
      }

      const salesTrend = Object.entries(monthly).map(([month, total]) => ({ month, total }));
      const weeklySalesTrend = Object.entries(weekly)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([week, total]) => ({ week, total }));

      // Bundle profit ranking
      const bundleStats = {};
      for (const l of salesLines || []) {
        const id = l.bundle_id;
        if (!id) continue;

        const revenue = Number(l.packs_qty || 0) * Number(l.unit_price || 0);
        const cogs = Number(l.packs_qty || 0) * Number(l.unit_cost || 0);
        const profit = revenue - cogs;

        if (!bundleStats[id]) {
          bundleStats[id] = { name: l.bundles?.name || 'Unknown', totalProfit: 0 };
        }
        bundleStats[id].totalProfit += profit;
      }

      const sortedBundles = Object.values(bundleStats).sort((a, b) => b.totalProfit - a.totalProfit);
      const topBundles = sortedBundles.slice(0, 5);
      const bottomBundles = sortedBundles.slice(-5).reverse();

      // Stock chart
      const stockByBundle = (stockRows || []).map((r) => ({
        name: r.name,
        packs: Number(r.packs_in_stock || 0),
      }));

      setData({
        totalRevenue,
        totalCost,
        totalProfit,
        grossMargin,
        receivables,
        payables,
        salesTrend,
        weeklySalesTrend,
        topBundles,
        bottomBundles,
        stockByBundle,
      });
    } catch (err) {
      setMessage(err.message || 'Failed to load analytics.');
    } finally {
      setIsLoading(false);
    }
  }, [supabaseClient, getStartDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (isLoading) return <div className="loading">Loading analytics...</div>;
  if (message) return <div className="message error">{message}</div>;
  if (!data) return <div>No analytics available.</div>;

  return (
    <div className="card">
      <h2>📊 Business Overview</h2>

      <div style={{ marginBottom: '1rem' }}>
        <label>Date Range: </label>
        <select value={range} onChange={(e) => setRange(e.target.value)}>
          <option value="monthly">Monthly</option>
          <option value="last3months">Last 3 Months</option>
          <option value="ytd">Year to Date</option>
        </select>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <strong>Total Revenue:</strong>
          <p>{currencyFormatter.format(data.totalRevenue)}</p>
        </div>
        <div className="metric-card">
          <strong>COGS:</strong>
          <p>{currencyFormatter.format(data.totalCost)}</p>
        </div>
        <div className="metric-card">
          <strong>Net Profit:</strong>
          <p>{currencyFormatter.format(data.totalProfit)}</p>
        </div>
        <div className="metric-card">
          <strong>Gross Margin:</strong>
          <p>{percentageFormatter.format(data.grossMargin)}</p>
        </div>
        <div className="metric-card">
          <strong>Receivables:</strong>
          <p>{currencyFormatter.format(data.receivables)}</p>
        </div>
        <div className="metric-card">
          <strong>Payables:</strong>
          <p>{currencyFormatter.format(data.payables)}</p>
        </div>
      </div>

      <div className="analytic-section">
        <h3>📈 Monthly Sales Trend</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data.salesTrend}>
            <CartesianGrid stroke="#ccc" />
            <XAxis dataKey="month" />
            <YAxis tickFormatter={(v) => currencyFormatter.format(v)} />
            <Tooltip formatter={(v) => currencyFormatter.format(v)} />
            <Line type="monotone" dataKey="total" stroke="#3b82f6" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="analytic-section">
        <h3>📅 Week-on-Week Sales Trend</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data.weeklySalesTrend}>
            <CartesianGrid stroke="#ccc" />
            <XAxis dataKey="week" />
            <YAxis tickFormatter={(v) => currencyFormatter.format(v)} />
            <Tooltip formatter={(v) => currencyFormatter.format(v)} />
            <Line type="monotone" dataKey="total" stroke="#6366f1" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="analytic-section">
        <h3>🏆 Top 5 Bundles by Profit</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data.topBundles}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis tickFormatter={(v) => currencyFormatter.format(v)} />
            <Tooltip formatter={(v) => currencyFormatter.format(v)} />
            <Bar dataKey="totalProfit" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="analytic-section">
        <h3>⚠️ Bottom 5 Bundles by Profit</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data.bottomBundles}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis tickFormatter={(v) => currencyFormatter.format(v)} />
            <Tooltip formatter={(v) => currencyFormatter.format(v)} />
            <Bar dataKey="totalProfit" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="analytic-section">
        <h3>📦 Current Stock (Packs)</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data.stockByBundle}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="packs" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
