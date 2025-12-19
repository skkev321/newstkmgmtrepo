import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Plus, RotateCw, Save, Tags, Truck } from 'lucide-react';
import { cn } from '../lib/utils';

export default function AddBundleTypeForm({ supabaseClient }) {
  // Add form
  const [name, setName] = useState('');
  const [packsPerBundle, setPacksPerBundle] = useState('');
  const [expectedSellPerBundle, setExpectedSellPerBundle] = useState('');
  const [sku, setSku] = useState('');
  const [message, setMessage] = useState('');

  // Existing bundles
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  // Edit bundle fields (per row)
  const [edit, setEdit] = useState({}); // { [bundleId]: { expected_selling_price_per_bundle, sku, is_active } }

  // Suppliers + supplier-specific default costs
  const [suppliers, setSuppliers] = useState([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [supplierCosts, setSupplierCosts] = useState([]); // rows from supplier_bundle_costs for selected supplier

  // Edit buying prices (per bundle for selected supplier)
  const [buyEdit, setBuyEdit] = useState({}); // { [bundleId]: "123.45" }
  const [savingBuy, setSavingBuy] = useState(false);

  const supplierNameById = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);

  const loadSuppliers = useCallback(async () => {
    const { data, error } = await supabaseClient
      .schema('app')
      .from('suppliers')
      .select('id,name,is_active')
      .eq('is_active', true)
      .order('name');

    if (error) {
      setSuppliers([]);
      return;
    }
    setSuppliers(data || []);
  }, [supabaseClient]);

  const loadBundles = useCallback(async () => {
    setLoading(true);
    setMessage('');

    const { data, error } = await supabaseClient
      .schema('app')
      .from('bundles')
      .select('id,name,packs_per_bundle,expected_selling_price_per_bundle,sku,is_active,created_at')
      .order('name');

    if (error) {
      setMessage(`Error loading bundle types: ${error.message}`);
      setRows([]);
      setLoading(false);
      return;
    }

    setRows(data || []);

    // refresh edit cache for bundle-level fields
    const nextEdit = {};
    for (const r of data || []) {
      nextEdit[r.id] = {
        expected_selling_price_per_bundle: String(r.expected_selling_price_per_bundle ?? ''),
        sku: r.sku ?? '',
        is_active: r.is_active ?? true,
      };
    }
    setEdit(nextEdit);

    setLoading(false);
  }, [supabaseClient]);

  const loadSupplierCosts = useCallback(
    async (supplierId) => {
      if (!supplierId) {
        setSupplierCosts([]);
        setBuyEdit({});
        return;
      }

      const { data, error } = await supabaseClient
        .schema('app')
        .from('supplier_bundle_costs')
        .select('supplier_id,bundle_id,default_cost_per_bundle,updated_at')
        .eq('supplier_id', supplierId);

      if (error) {
        setSupplierCosts([]);
        setBuyEdit({});
        return;
      }

      const list = data || [];
      setSupplierCosts(list);

      // Map bundleId -> default cost for editing
      const m = {};
      for (const r of list) {
        m[r.bundle_id] = String(r.default_cost_per_bundle ?? '');
      }

      // Ensure all bundle IDs exist in buyEdit (empty allowed)
      const merged = {};
      for (const b of rows) {
        merged[b.id] = m[b.id] ?? '';
      }
      setBuyEdit(merged);
    },
    [supabaseClient, rows]
  );

  // Initial load
  useEffect(() => {
    (async () => {
      await loadSuppliers();
      await loadBundles();
    })();
  }, [loadSuppliers, loadBundles]);

  // Reload supplier costs when supplier changes OR when bundles list changes
  useEffect(() => {
    (async () => {
      if (selectedSupplierId) {
        await loadSupplierCosts(selectedSupplierId);
      }
    })();
  }, [selectedSupplierId, loadSupplierCosts]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setMessage('');

    const cleanName = name.trim();
    if (!cleanName) return setMessage('Bundle name is required.');

    const ppb = parseInt(packsPerBundle, 10);
    if (!ppb || ppb <= 0) return setMessage('Packs per bundle must be > 0.');

    const expected = parseFloat(expectedSellPerBundle);
    if (!(expected >= 0)) return setMessage('Expected selling price per bundle must be >= 0.');

    const { error } = await supabaseClient.schema('app').from('bundles').insert([
      {
        name: cleanName,
        packs_per_bundle: ppb,
        expected_selling_price_per_bundle: expected,
        sku: sku.trim() ? sku.trim() : null,
        is_active: true,
      },
    ]);

    if (error) {
      if ((error.message || '').toLowerCase().includes('duplicate')) {
        return setMessage('Error: Bundle name already exists.');
      }
      return setMessage(`Error: ${error.message}`);
    }

    setMessage('Bundle type added successfully!');
    setName('');
    setPacksPerBundle('');
    setExpectedSellPerBundle('');
    setSku('');

    await loadBundles();

    // Refresh supplier costs editor if a supplier is selected
    if (selectedSupplierId) {
      await loadSupplierCosts(selectedSupplierId);
    }
  };

  const updateEdit = (bundleId, field, value) => {
    setEdit((prev) => ({
      ...prev,
      [bundleId]: {
        ...(prev[bundleId] || {}),
        [field]: value,
      },
    }));
  };

  const saveBundleEdit = async (bundleId) => {
    setMessage('');
    const rowEdit = edit[bundleId];
    if (!rowEdit) return;

    const expected = parseFloat(rowEdit.expected_selling_price_per_bundle || '0');
    if (!(expected >= 0)) return setMessage('Expected selling price per bundle must be >= 0.');

    const { error } = await supabaseClient
      .schema('app')
      .from('bundles')
      .update({
        expected_selling_price_per_bundle: expected,
        sku: rowEdit.sku?.trim() ? rowEdit.sku.trim() : null,
        is_active: !!rowEdit.is_active,
      })
      .eq('id', bundleId);

    if (error) return setMessage(`Error saving changes: ${error.message}`);

    setMessage('Bundle type updated (applies going forward).');
    await loadBundles();

    if (selectedSupplierId) {
      await loadSupplierCosts(selectedSupplierId);
    }
  };

  const updateBuyEdit = (bundleId, value) => {
    setBuyEdit((prev) => ({ ...prev, [bundleId]: value }));
  };

  const saveSupplierBuyingPrices = async () => {
    setMessage('');

    if (!selectedSupplierId) {
      return setMessage('Select a supplier to set buying prices.');
    }

    setSavingBuy(true);
    try {
      // Upsert only rows that have a value (empty allowed)
      const payload = Object.entries(buyEdit)
        .map(([bundleId, val]) => ({
          bundle_id: bundleId,
          supplier_id: selectedSupplierId,
          val: val,
        }))
        .filter((x) => x.val !== null && String(x.val).trim() !== '');

      for (const item of payload) {
        const cost = parseFloat(item.val);
        if (!(cost >= 0)) {
          throw new Error('Buying price must be >= 0 for all filled values.');
        }

        const { error } = await supabaseClient.schema('app').from('supplier_bundle_costs').upsert(
          [
            {
              supplier_id: item.supplier_id,
              bundle_id: item.bundle_id,
              default_cost_per_bundle: cost,
              updated_at: new Date().toISOString(),
            },
          ],
          { onConflict: 'supplier_id,bundle_id' }
        );

        if (error) throw error;
      }

      setMessage(
        `Saved default buying prices for supplier: ${supplierNameById.get(selectedSupplierId) || selectedSupplierId}`
      );

      await loadSupplierCosts(selectedSupplierId);
    } catch (err) {
      setMessage(`Error saving buying prices: ${err?.message || 'Unknown error'}`);
    } finally {
      setSavingBuy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Tags className="h-5 w-5" /> Manage Bundle Types
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Define bundle structures. "Packs per bundle" is fixed. Buying prices are managed per supplier.
          </p>
        </CardHeader>
        <CardContent>
          {message && (
            <div className={cn("p-3 mb-6 rounded-md text-sm font-medium", message.toLowerCase().includes('error') ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-600")}>
              {message}
            </div>
          )}

          <div className="bg-muted/30 p-4 rounded-lg border mb-6">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Plus className="h-4 w-4" /> Add New Bundle Type
            </h3>
            <form onSubmit={handleSubmit} className="grid sm:grid-cols-2 md:grid-cols-4 gap-4 items-end">
              <div className="space-y-2">
                <label className="text-xs font-medium">Bundle Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 500g Packet" required />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium">Packs/Bundle</label>
                <Input type="number" min="1" value={packsPerBundle} onChange={(e) => setPacksPerBundle(e.target.value)} placeholder="Qty" required />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium">Exp. Sell (LKR)</label>
                <Input type="number" step="0.01" min="0" value={expectedSellPerBundle} onChange={(e) => setExpectedSellPerBundle(e.target.value)} placeholder="Price" required />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium">SKU (Opt)</label>
                <div className="flex gap-2">
                  <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Code" className="flex-1" />
                  <Button type="submit" size="default">Add</Button>
                </div>
              </div>
            </form>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Existing Bundles</h3>
              <Button variant="outline" size="sm" onClick={loadBundles}>
                <RotateCw className={cn("h-3.5 w-3.5 mr-2", loading && "animate-spin")} /> Refresh
              </Button>
            </div>

            <div className="rounded-md border overflow-x-auto">
              <table className="w-full caption-bottom text-sm">
                <thead>
                  <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted bg-muted/50">
                    <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Name</th>
                    <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Qty</th>
                    <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground w-[150px]">Sell Price</th>
                    <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground w-[120px]">SKU</th>
                    <th className="h-10 px-4 text-center align-middle font-medium text-muted-foreground w-[80px]">Active</th>
                    <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground w-[100px]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="6" className="p-4 text-center text-muted-foreground">Loading...</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan="6" className="p-4 text-center text-muted-foreground">No bundle types found.</td></tr>
                  ) : (
                    rows.map((r) => {
                      const e = edit[r.id] || {};
                      return (
                        <tr key={r.id} className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                          <td className="p-3 font-medium">{r.name}</td>
                          <td className="p-3">{r.packs_per_bundle}</td>
                          <td className="p-3">
                            <Input
                              type="number"
                              step="0.01"
                              className="h-8"
                              value={e.expected_selling_price_per_bundle ?? ''}
                              onChange={(ev) => updateEdit(r.id, 'expected_selling_price_per_bundle', ev.target.value)}
                            />
                          </td>
                          <td className="p-3">
                            <Input
                              className="h-8"
                              value={e.sku ?? ''}
                              onChange={(ev) => updateEdit(r.id, 'sku', ev.target.value)}
                            />
                          </td>
                          <td className="p-3 text-center">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                              checked={!!e.is_active}
                              onChange={(ev) => updateEdit(r.id, 'is_active', ev.target.checked)}
                            />
                          </td>
                          <td className="p-3 text-right">
                            <Button size="sm" variant="ghost" onClick={() => saveBundleEdit(r.id)}>
                              <Save className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" /> Supplier Buying Prices
          </CardTitle>
          <div className="flex flex-col sm:flex-row gap-4 mt-2">
            <div className="flex-1 max-w-md">
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={selectedSupplierId}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
              >
                <option value="">Select Supplier to Edit Prices...</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <Button onClick={saveSupplierBuyingPrices} disabled={!selectedSupplierId || savingBuy}>
                {savingBuy && <RotateCw className="mr-2 h-4 w-4 animate-spin" />}
                Save Prices
              </Button>
              <Button variant="outline" onClick={() => selectedSupplierId && loadSupplierCosts(selectedSupplierId)} disabled={!selectedSupplierId}>
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!selectedSupplierId ? (
            <div className="text-center p-8 text-muted-foreground border rounded-lg border-dashed">
              Select a supplier above to manage their default buying prices.
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full caption-bottom text-sm">
                <thead>
                  <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted bg-muted/50">
                    <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Bundle</th>
                    <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground w-[200px]">Default Cost (LKR)</th>
                    <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground">Last Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan="3" className="p-4 text-center text-muted-foreground">No bundles defined.</td></tr>
                  ) : (
                    rows.map(b => {
                      const costRow = supplierCosts.find((x) => x.bundle_id === b.id) || null;
                      const lastUpdated = costRow?.updated_at
                        ? new Date(costRow.updated_at).toLocaleString('en-LK', { timeZone: 'Asia/Colombo' })
                        : '—';
                      return (
                        <tr key={b.id} className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                          <td className="p-3 font-medium">{b.name}</td>
                          <td className="p-3">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="Set default cost..."
                              value={buyEdit[b.id] ?? ''}
                              onChange={(e) => updateBuyEdit(b.id, e.target.value)}
                              className="max-w-[180px]"
                            />
                          </td>
                          <td className="p-3 text-right text-muted-foreground text-xs">{lastUpdated}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
