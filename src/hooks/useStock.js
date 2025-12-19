import { useState, useCallback, useEffect, useMemo } from 'react';

export function useStock(supabaseClient) {
    const [stock, setStock] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchStock = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error } = await supabaseClient
                .schema('app')
                .from('v_current_stock')
                .select('bundle_id,name,packs_in_stock')
                .order('name');

            if (error) throw error;
            // Filter only positive stock
            setStock((data || []).filter((x) => Number(x.packs_in_stock) > 0));
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [supabaseClient]);

    useEffect(() => {
        fetchStock();
    }, [fetchStock]);

    const stockByBundle = useMemo(() => {
        const m = new Map();
        for (const b of stock) m.set(b.bundle_id, b);
        return m;
    }, [stock]);

    return { stock, stockByBundle, loading, error, refresh: fetchStock };
}
