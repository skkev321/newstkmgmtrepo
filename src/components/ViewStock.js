import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Search, RotateCw, Package, ArrowRightLeft } from 'lucide-react';
import { cn } from '../lib/utils';

export default function ViewStock({ supabaseClient }) {
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Adjustment UI (row-level)
  const [openAdjustFor, setOpenAdjustFor] = useState(null); // bundle_id
  const [type, setType] = useState('adjustment_out');
  const [packs, setPacks] = useState('');
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Movements
  const [movements, setMovements] = useState([]);
  const [movementFilterBundleId, setMovementFilterBundleId] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setMessage('');

    try {
      const { data: cs, error: csErr } = await supabaseClient
        .schema('app')
        .from('v_current_stock')
        .select('bundle_id,name,packs_in_stock')
        .order('name');

      if (csErr) throw csErr;

      const stock = cs || [];
      const bundleIds = [...new Set(stock.map((x) => x.bundle_id).filter(Boolean))];

      let bundles = [];
      if (bundleIds.length > 0) {
        const { data: b, error: bErr } = await supabaseClient
          .schema('app')
          .from('bundles')
          .select('id,packs_per_bundle')
          .in('id', bundleIds);

        if (bErr) throw bErr;
        bundles = b || [];
      }

      const packsPerBundleById = new Map(bundles.map((b) => [b.id, Number(b.packs_per_bundle || 0)]));

      const normalized = stock.map((r) => ({
        bundle_id: r.bundle_id,
        name: r.name,
        packs_in_stock: Number(r.packs_in_stock || 0),
        packs_per_bundle: packsPerBundleById.get(r.bundle_id) || 0,
      }));

      setRows(normalized);
    } catch (error) {
      setMessage(error?.message || 'Failed to load stock.');
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [supabaseClient]);

  const loadMovements = useCallback(async () => {
    let q = supabaseClient
      .schema('app')
      .from('stock_movements')
      .select('id,movement_type,movement_datetime,bundle_id,packs_delta,reason,bundles(name)')
      .order('movement_datetime', { ascending: false })
      .limit(50);

    if (movementFilterBundleId) q = q.eq('bundle_id', movementFilterBundleId);

    const { data, error } = await q;
    if (!error) setMovements(data || []);
  }, [supabaseClient, movementFilterBundleId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadMovements();
  }, [loadMovements]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.name || '').toLowerCase().includes(q));
  }, [rows, search]);

  const currentRow = useMemo(() => rows.find((r) => r.bundle_id === openAdjustFor) || null, [rows, openAdjustFor]);

  const qty = parseInt(packs || '0', 10);
  const delta = type === 'adjustment_in' ? qty : -qty;
  const resulting = currentRow ? currentRow.packs_in_stock + (Number.isFinite(delta) ? delta : 0) : null;

  const submitAdjustment = async (e) => {
    e.preventDefault();
    setMessage('');
    if (!openAdjustFor) return setMessage('Select a bundle to adjust.');
    if (!qty || qty <= 0) return setMessage('Enter packs > 0.');

    if (type === 'adjustment_out' && !reason.trim()) {
      return setMessage('Reason is required when removing stock.');
    }

    setIsSaving(true);

    const { error } = await supabaseClient.schema('app').from('stock_movements').insert([
      {
        movement_type: type,
        movement_datetime: new Date().toISOString(),
        bundle_id: openAdjustFor,
        packs_delta: delta,
        reason: reason.trim() ? reason.trim() : null,
      },
    ]);

    setIsSaving(false);

    if (error) {
      setMessage(`Error: ${error.message}`);
      return;
    }

    setMessage('✅ Stock adjustment saved.');
    setPacks('');
    setReason('');
    await load();
    await loadMovements();
  };

  const badgeFor = (packsInStock) => {
    if (packsInStock <= 0) return { text: 'OUT', className: 'bg-destructive/10 text-destructive' };
    if (packsInStock <= 10) return { text: 'LOW', className: 'bg-yellow-500/10 text-yellow-600' };
    return { text: 'OK', className: 'bg-emerald-500/10 text-emerald-600' };
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" /> Current Stock
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 w-[250px]"
              />
            </div>
            <Button variant="outline" size="icon" onClick={load} disabled={isLoading || isSaving}>
              <RotateCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {message && (
            <div className={cn("p-3 mb-4 rounded-md text-sm font-medium", message.startsWith('Error') ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-600")}>
              {message}
            </div>
          )}

          <div className="rounded-md border">
            <table className="w-full caption-bottom text-sm">
              <thead>
                <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Bundle</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Packs/Bundle</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">In Stock</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Est. Bundles</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Status</th>
                  <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="p-4 text-center text-muted-foreground">No stock data found.</td>
                  </tr>
                ) : (
                  filteredRows.map((r) => {
                    const status = badgeFor(r.packs_in_stock);
                    const eqBundles = r.packs_per_bundle > 0 ? r.packs_in_stock / r.packs_per_bundle : null;

                    return (
                      <React.Fragment key={r.bundle_id}>
                        <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                          <td className="p-4 font-medium">{r.name}</td>
                          <td className="p-4">{r.packs_per_bundle || '—'}</td>
                          <td className="p-4">{r.packs_in_stock}</td>
                          <td className="p-4">{eqBundles == null ? '—' : eqBundles.toFixed(2)}</td>
                          <td className="p-4">
                            <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2", status.className)}>
                              {status.text}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            <Button
                              variant={openAdjustFor === r.bundle_id ? "secondary" : "ghost"}
                              size="sm"
                              onClick={() => {
                                setOpenAdjustFor((cur) => (cur === r.bundle_id ? null : r.bundle_id));
                                setType('adjustment_out');
                                setPacks('');
                                setReason('');
                                setMovementFilterBundleId(r.bundle_id);
                              }}
                            >
                              Adjust
                            </Button>
                          </td>
                        </tr>
                        {openAdjustFor === r.bundle_id && (
                          <tr className="bg-muted/50">
                            <td colSpan="6" className="p-4">
                              <div className="rounded-lg border bg-card text-card-foreground shadow-sm max-w-2xl mx-auto">
                                <div className="p-6">
                                  <div className="flex items-center justify-between mb-4">
                                    <div>
                                      <h3 className="font-semibold leading-none tracking-tight">Adjust Stock: {r.name}</h3>
                                      <p className="text-sm text-muted-foreground mt-1">Current: {r.packs_in_stock} packs</p>
                                    </div>
                                    <Button variant="ghost" size="sm" onClick={() => setOpenAdjustFor(null)}>Cancel</Button>
                                  </div>

                                  <form onSubmit={submitAdjustment} className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                      <div className="space-y-2">
                                        <label className="text-sm font-medium">Action</label>
                                        <select
                                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                          value={type} onChange={(e) => setType(e.target.value)} disabled={isSaving}
                                        >
                                          <option value="adjustment_out">Remove (Lost/Damaged)</option>
                                          <option value="adjustment_in">Add (Correction)</option>
                                        </select>
                                      </div>
                                      <div className="space-y-2">
                                        <label className="text-sm font-medium">Quantity (Packs)</label>
                                        <Input type="number" min="1" value={packs} onChange={(e) => setPacks(e.target.value)} disabled={isSaving} required />
                                      </div>
                                    </div>

                                    <div className="space-y-2">
                                      <label className="text-sm font-medium">Reason</label>
                                      <Input
                                        value={reason}
                                        onChange={(e) => setReason(e.target.value)}
                                        placeholder={type === 'adjustment_out' ? "Required..." : "Optional..."}
                                        disabled={isSaving}
                                      />
                                    </div>

                                    <div className="rounded-md bg-muted p-3 text-sm">
                                      <div className="flex justify-between items-center">
                                        <span>Resulting Stock:</span>
                                        <span className={cn("font-bold", resulting != null && resulting < 0 && "text-destructive")}>
                                          {resulting == null ? '—' : resulting}
                                        </span>
                                      </div>
                                      {resulting != null && resulting < 0 && (
                                        <p className="text-destructive text-xs mt-1">Warning: Stock cannot be negative.</p>
                                      )}
                                    </div>

                                    <div className="flex justify-end pt-2">
                                      <Button type="submit" disabled={isSaving}>
                                        {isSaving && <RotateCw className="mr-2 h-4 w-4 animate-spin" />}
                                        {isSaving ? 'Saving...' : 'Save Adjustment'}
                                      </Button>
                                    </div>
                                  </form>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" /> Recent Movements
          </CardTitle>
          <div className="flex items-center gap-2">
            <select
              className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={movementFilterBundleId}
              onChange={(e) => setMovementFilterBundleId(e.target.value)}
            >
              <option value="">All Bundles</option>
              {rows.map((r) => (
                <option key={r.bundle_id} value={r.bundle_id}>{r.name}</option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={loadMovements}>Refresh</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <table className="w-full caption-bottom text-sm">
              <thead>
                <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-[200px]">Date/Time</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Bundle</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Type</th>
                  <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Delta</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground pl-8">Reason</th>
                </tr>
              </thead>
              <tbody>
                {movements.length === 0 ? (
                  <tr><td colSpan="5" className="p-4 text-center text-muted-foreground">No history found.</td></tr>
                ) : (
                  movements.map((m) => (
                    <tr key={m.id} className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                      <td className="p-4">{new Date(m.movement_datetime).toLocaleString('en-LK', { timeZone: 'Asia/Colombo' })}</td>
                      <td className="p-4 font-medium">{m.bundles?.name || '—'}</td>
                      <td className="p-4">
                        <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-foreground">
                          {m.movement_type}
                        </span>
                      </td>
                      <td className={cn("p-4 text-right font-mono", m.packs_delta > 0 ? "text-emerald-600" : "text-destructive")}>
                        {m.packs_delta > 0 ? "+" : ""}{m.packs_delta}
                      </td>
                      <td className="p-4 pl-8 text-muted-foreground">{m.reason || '—'}</td>
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
