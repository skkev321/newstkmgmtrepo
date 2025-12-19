import React, { useCallback, useEffect, useState } from 'react';
import { currencyFormatter, percentageFormatter } from './formatters';

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
    <div className="card">
      <h2>📊 Financial Summary</h2>
      {message && <p className="message error">{message}</p>}
      {isLoading && <p className="loading">Loading report...</p>}

      <div className="form-grid">
        <div className="form-group">
          <label>Report Period:</label>
          <select value={timePeriod} onChange={(e) => setTimePeriod(e.target.value)}>
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        {timePeriod === 'custom' && (
          <>
            <div className="form-group">
              <label>Start Date:</label>
              <input type="date" value={customStartDate} onChange={(e) => setCustomStartDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>End Date:</label>
              <input type="date" value={customEndDate} onChange={(e) => setCustomEndDate(e.target.value)} />
            </div>
          </>
        )}

        <div className="form-actions">
          <button className="button primary" onClick={fetchReportData}>
            Refresh
          </button>
        </div>
      </div>

      {reportData && (
        <div className="report-content">
          <h3>
            {timePeriod === 'monthly' ? 'Monthly' : timePeriod === 'weekly' ? 'Weekly' : 'Custom'} Report (
            {new Date(reportData.startDate).toLocaleDateString('en-LK')} -{' '}
            {new Date(reportData.endDate).toLocaleDateString('en-LK')})
          </h3>

          <div className="metrics-grid">
            <div className="metric-card">
              <h4>💰 Sales</h4>
              <p>Total: {currencyFormatter.format(reportData.totalSales)}</p>
              <p>COGS: {currencyFormatter.format(reportData.totalCost)}</p>
              <p>Profit: {currencyFormatter.format(reportData.totalProfit)}</p>
              <p>Margin: {percentageFormatter.format(reportData.profitMargin)}</p>
            </div>

            <div className="metric-card">
              <h4>🧾 Transactions</h4>
              <p>Sales Invoices: {reportData.salesCount}</p>
              <p>Avg Sale: {currencyFormatter.format(reportData.avgSale)}</p>
              <p>Purchase Invoices: {reportData.purchaseCount}</p>
            </div>

            <div className="metric-card">
              <h4>📌 Outstanding</h4>
              <p>Receivables: {currencyFormatter.format(reportData.receivables)}</p>
              <p>Payables: {currencyFormatter.format(reportData.payables)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
