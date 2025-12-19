import { useState, useCallback, useEffect } from 'react';

export function useCustomers(supabaseClient) {
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchCustomers = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error } = await supabaseClient
                .schema('app')
                .from('customers')
                .select('id,name')
                .eq('is_active', true)
                .order('name');

            if (error) throw error;
            setCustomers(data || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [supabaseClient]);

    const createCustomer = useCallback(async (name) => {
        setLoading(true);
        try {
            const { data, error } = await supabaseClient
                .schema('app')
                .from('customers')
                .insert([{ name, is_active: true }])
                .select('id,name')
                .single();

            if (error) throw error;
            await fetchCustomers(); // Refresh list
            return data;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [supabaseClient, fetchCustomers]);

    useEffect(() => {
        fetchCustomers();
    }, [fetchCustomers]);

    return { customers, loading, error, createCustomer, refresh: fetchCustomers };
}
