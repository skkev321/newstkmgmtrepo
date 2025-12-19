import React, { useCallback, useEffect, useState } from 'react';
import { currencyFormatter, percentageFormatter } from './formatters';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { BarChart3, Calendar, DollarSign, TrendingUp, ShoppingBag, CreditCard, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';

export default function ViewBorrowing({ supabaseClient }) {
  const [reportData, setReportData] = useState(null);
  const [message, setMessage] = useState('');
  const [timePeriod, setTimePeriod] = useState('monthly');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const computeRange = useCallback(() => {
    let startDate, endDate;
    const today = new Date();

    if (timePeriod === 'monthly') {
      startDate = new Date(today.getFullYear(), today.getMonth(), 1);
      endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (timePeriod === 'weekly') {
      const dayOfWeek = today.getDay();
      startDate = new Date(today);
      startDate.setDate(today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
    } else {
      if (!customStartDate || !customEndDate) {
        throw new Error('Please select both start and end dates.');
      }
      startDate = new Date(customStartDate);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(customEndDate);
      endDate.setHours(23, 59, 59, 999);

      if (startDate > endDate) throw new Error('Start date cannot be after end date.');
    }

    return { startDate, endDate };
  }, [timePeriod, customStartDate, customEndDate]);

  const fetchReportData = useCallback(async () => {
    setIsLoading(true);
    setMessage('');

    try {
      const { startDate, endDate } = computeRange();

      // Sales invoices in period
      const { data: salesInvoices, error: siErr } = await supabaseClient
        .schema('app')
        .from('sales_invoices')
        .select('id,invoice_date,total')
        .gte('invoice_date', startDate.toISOString())
        .lte('invoice_date', endDate.toISOString());

      if (siErr) throw siErr;

      const salesInvoiceIds = (salesInvoices || []).map((x) => x.id);

      // Sales COGS from invoice lines: packs_qty * unit_cost
      let totalCost = 0;
      if (salesInvoiceIds.length > 0) {
        const { data: sLines, error: slErr } = await supabaseClient
          .schema('app')
          .from('sales_invoice_lines')
          .select('invoice_id,packs_qty,unit_cost')
          .in('invoice_id', salesInvoiceIds);

        if (slErr) throw slErr;

        totalCost = (sLines || []).reduce(
          (sum, l) => sum + Number(l.packs_qty || 0) * Number(l.unit_cost || 0),
          0
        );
      }

      const totalSales = (salesInvoices || []).reduce((sum, inv) => sum + Number(inv.total || 0), 0);
      const totalProfit = totalSales - totalCost;
      const profitMargin = totalSales > 0 ? totalProfit / totalSales : 0;

      // Receivables (balance due for those invoices)
      let receivables = 0;
      if (salesInvoiceIds.length > 0) {
        const { data: sBal, error: sbErr } = await supabaseClient
          .schema('app')
          .from('v_sales_invoice_balance')
          .select('id,balance_due')
          .in('id', salesInvoiceIds);

        if (sbErr) throw sbErr;

        receivables = (sBal || []).reduce((sum, r) => sum + Number(r.balance_due || 0), 0);
      }

      // Purchase invoices in period
      const { data: purchaseInvoices, error: piErr } = await supabaseClient
        .schema('app')
        .from('purchase_invoices')
        .select('id,invoice_date,total')
        .gte('invoice_date', startDate.toISOString())
        .lte('invoice_date', endDate.toISOString());

      if (piErr) throw piErr;

      const purchaseInvoiceIds = (purchaseInvoices || []).map((x) => x.id);

      // Payables
      let payables = 0;
      if (purchaseInvoiceIds.length > 0) {
        const { data: pBal, error: pbErr } = await supabaseClient
          .schema('app')
          .from('v_purchase_invoice_balance')
          .select('id,balance_due')
          .in('id', purchaseInvoiceIds);

        if (pbErr) throw pbErr;

        payables = (pBal || []).reduce((sum, r) => sum + Number(r.balance_due || 0), 0);
      }

      const avgSale = (salesInvoices || []).length > 0 ? totalSales / salesInvoices.length : 0;

      setReportData({
        totalSales,
        totalCost,
        totalProfit,
        receivables,
        payables,
        salesCount: (salesInvoices || []).length,
        purchaseCount: (purchaseInvoices || []).length,
        avgSale,
        profitMargin,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
    } catch (err) {
      setMessage(err.message || 'Failed to generate report.');
    } finally {
      setIsLoading(false);
    }
  }, [supabaseClient, computeRange]);

  useEffect(() => {
    fetchReportData();
  }, [fetchReportData]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" /> Financial Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          {message && (
            <div className="p-4 mb-4 rounded-md bg-destructive/10 text-destructive text-sm font-medium">
              {message}
            </div>
          )}

          <div className="flex flex-col md:flex-row gap-4 items-end bg-muted/30 p-4 rounded-lg border">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
              <div className="space-y-2">
                <label className="text-sm font-medium">Report Period</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <select
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 pl-9 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    value={timePeriod}
                    onChange={(e) => setTimePeriod(e.target.value)}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="weekly">Weekly</option>
                    <option value="custom">Custom Range</option>
                  </select>
                </div>
              </div>

              {timePeriod === 'custom' && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Start Date</label>
                    <Input type="date" value={customStartDate} onChange={(e) => setCustomStartDate(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">End Date</label>
                    <Input type="date" value={customEndDate} onChange={(e) => setCustomEndDate(e.target.value)} />
                  </div>
                </>
              )}
            </div>

            <Button onClick={fetchReportData} disabled={isLoading} className="w-full md:w-auto min-w-[120px]">
              {isLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
          </div>

          {reportData && (
            <div className="mt-8 space-y-6 animate-in fade-in duration-500">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-muted-foreground">
                  Report Period: <span className="text-foreground">{new Date(reportData.startDate).toLocaleDateString('en-LK')} - {new Date(reportData.endDate).toLocaleDateString('en-LK')}</span>
                </h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Sales Card */}
                <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border-blue-200 dark:border-blue-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-blue-800 dark:text-blue-300 flex items-center gap-2">
                      <DollarSign className="h-4 w-4" /> Revenue & Profit
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">{currencyFormatter.format(reportData.totalSales)}</div>
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">Total Sales</p>

                    <div className="mt-4 pt-4 border-t border-blue-200 dark:border-blue-800 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-blue-700 dark:text-blue-300">COGS</span>
                        <span className="font-medium">{currencyFormatter.format(reportData.totalCost)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-blue-700 dark:text-blue-300">Gross Profit</span>
                        <span className="font-bold text-emerald-600 dark:text-emerald-400">{currencyFormatter.format(reportData.totalProfit)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-blue-700 dark:text-blue-300">Margin</span>
                        <span className="font-medium">{percentageFormatter.format(reportData.profitMargin)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Transactions Card */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <ShoppingBag className="h-4 w-4" /> Transaction Volume
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{reportData.salesCount}</div>
                    <p className="text-xs text-muted-foreground mt-1">Sales Invoices</p>

                    <div className="mt-4 pt-4 border-t space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Avg Value</span>
                        <span className="font-medium">{currencyFormatter.format(reportData.avgSale)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Purchases</span>
                        <span className="font-medium">{reportData.purchaseCount} Invoices</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Outstanding Card */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" /> Outstanding Balance
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div>
                        <div className="text-2xl font-bold text-emerald-600">{currencyFormatter.format(reportData.receivables)}</div>
                        <p className="text-xs text-muted-foreground mt-1">Receivables (To Collect)</p>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-destructive">{currencyFormatter.format(reportData.payables)}</div>
                        <p className="text-xs text-muted-foreground mt-1">Payables (To Pay)</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
