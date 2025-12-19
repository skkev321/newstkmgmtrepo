import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { currencyFormatter, percentageFormatter } from './formatters';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import moment from 'moment';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { ArrowUpRight, ArrowDownRight, DollarSign, Activity } from 'lucide-react';

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

  if (isLoading) return (
    <div className="flex h-[50vh] items-center justify-center">
      <div className="text-muted-foreground animate-pulse">Loading analytics...</div>
    </div>
  );

  if (message) return (
    <div className="p-4 rounded-md bg-destructive/10 text-destructive text-sm font-medium">
      {message}
    </div>
  );

  if (!data) return <div>No analytics available.</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-3xl font-bold tracking-tight text-primary">Business Overview</h2>
        <div className="flex items-center space-x-2">
          <select
            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            <option value="monthly">This Month</option>
            <option value="last3months">Last 3 Months</option>
            <option value="ytd">Year to Date</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{currencyFormatter.format(data.totalRevenue)}</div>
            <p className="text-xs text-muted-foreground pt-1">Gross sales for period</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{currencyFormatter.format(data.totalProfit)}</div>
            <div className="flex items-center text-xs text-muted-foreground pt-1">
              <span className={data.grossMargin > 0.2 ? "text-emerald-500" : "text-yellow-500"}>
                {percentageFormatter.format(data.grossMargin)}
              </span>
              <span className="ml-1">margin</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Receivables</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{currencyFormatter.format(data.receivables)}</div>
            <p className="text-xs text-muted-foreground pt-1">Pending payments from customers</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Payables</CardTitle>
            <ArrowDownRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{currencyFormatter.format(data.payables)}</div>
            <p className="text-xs text-muted-foreground pt-1">Pending payments to suppliers</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Sales Trend</CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={range === 'monthly' ? data.weeklySalesTrend : data.salesTrend}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey={range === 'monthly' ? "week" : "month"}
                  stroke="#888888"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#888888"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `$${value}`}
                />
                <Tooltip
                  formatter={(v) => currencyFormatter.format(v)}
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: 'var(--radius)' }}
                  itemStyle={{ color: 'hsl(var(--foreground))' }}
                />
                <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Top Items by Profit</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.topBundles} layout="vertical" margin={{ left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={true} vertical={false} />
                <XAxis type="number" hide />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={100}
                  stroke="#888888"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  formatter={(v) => currencyFormatter.format(v)}
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: 'var(--radius)' }}
                  itemStyle={{ color: 'hsl(var(--foreground))' }}
                />
                <Bar dataKey="totalProfit" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Low Profit Items</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.bottomBundles}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke="#888888"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#888888"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `$${value}`}
                />
                <Tooltip
                  formatter={(v) => currencyFormatter.format(v)}
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: 'var(--radius)' }}
                  itemStyle={{ color: 'hsl(var(--foreground))' }}
                />
                <Bar dataKey="totalProfit" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Current Inventory</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.stockByBundle}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke="#888888"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#888888"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: 'var(--radius)' }}
                  itemStyle={{ color: 'hsl(var(--foreground))' }}
                />
                <Bar dataKey="packs" fill="hsl(var(--secondary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
