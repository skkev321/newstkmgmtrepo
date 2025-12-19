-- Based on the codebase analysis, here is the inferred schema.
-- Run this in your Supabase SQL Editor.

-- 1. Create Schema
CREATE SCHEMA IF NOT EXISTS app;

-- 2. Tables

CREATE TABLE app.bundles (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    packs_per_bundle integer NOT NULL DEFAULT 1,
    expected_selling_price_per_bundle numeric DEFAULT 0,
    sku text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE app.customers (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE app.suppliers (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE app.supplier_bundle_costs (
    supplier_id uuid REFERENCES app.suppliers(id),
    bundle_id uuid REFERENCES app.bundles(id),
    default_cost_per_bundle numeric DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now(),
    PRIMARY KEY (supplier_id, bundle_id)
);

CREATE TABLE app.sales_invoices (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    invoice_no text NOT NULL UNIQUE,
    invoice_date timestamp with time zone DEFAULT now(),
    customer_id uuid REFERENCES app.customers(id),
    total numeric DEFAULT 0,
    discount numeric DEFAULT 0,
    other_charges numeric DEFAULT 0,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE app.sales_invoice_lines (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    invoice_id uuid REFERENCES app.sales_invoices(id) ON DELETE CASCADE,
    bundle_id uuid REFERENCES app.bundles(id),
    packs_qty integer NOT NULL,
    unit_price numeric NOT NULL DEFAULT 0,
    unit_cost numeric NOT NULL DEFAULT 0,
    line_total numeric GENERATED ALWAYS AS (packs_qty * unit_price) STORED
);

CREATE TABLE app.purchase_invoices (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    invoice_no text NOT NULL UNIQUE,
    supplier_id uuid REFERENCES app.suppliers(id),
    invoice_date timestamp with time zone DEFAULT now(),
    due_date timestamp with time zone,
    total numeric DEFAULT 0,
    discount numeric DEFAULT 0,
    other_charges numeric DEFAULT 0,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE app.purchase_invoice_lines (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    invoice_id uuid REFERENCES app.purchase_invoices(id) ON DELETE CASCADE,
    bundle_id uuid REFERENCES app.bundles(id),
    bundles_qty integer NOT NULL,
    unit_cost_per_bundle numeric NOT NULL DEFAULT 0,
    line_total numeric GENERATED ALWAYS AS (bundles_qty * unit_cost_per_bundle) STORED
);

CREATE TABLE app.payments (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    party_type text CHECK (party_type IN ('customer', 'supplier')),
    customer_id uuid REFERENCES app.customers(id),
    supplier_id uuid REFERENCES app.suppliers(id),
    direction text CHECK (direction IN ('in', 'out')), -- 'in' (customer pays us), 'out' (we pay supplier)
    amount numeric NOT NULL,
    payment_date timestamp with time zone DEFAULT now(),
    method text,
    reference text,
    note text,
    source text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE app.payment_allocations (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    payment_id uuid REFERENCES app.payments(id) ON DELETE CASCADE,
    invoice_type text CHECK (invoice_type IN ('sale', 'purchase')),
    sales_invoice_id uuid REFERENCES app.sales_invoices(id),
    purchase_invoice_id uuid REFERENCES app.purchase_invoices(id),
    amount_applied numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE app.stock_movements (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    movement_type text NOT NULL, -- 'sale_out', 'purchase_in', 'adjustment_in', 'adjustment_out'
    movement_datetime timestamp with time zone DEFAULT now(),
    bundle_id uuid REFERENCES app.bundles(id),
    packs_delta integer NOT NULL, -- can be negative
    sales_invoice_id uuid REFERENCES app.sales_invoices(id),
    purchase_invoice_id uuid REFERENCES app.purchase_invoices(id),
    reason text,
    created_at timestamp with time zone DEFAULT now()
);

-- 3. Views

-- v_current_stock
CREATE OR REPLACE VIEW app.v_current_stock AS
SELECT 
    b.id AS bundle_id,
    b.name,
    COALESCE(SUM(m.packs_delta), 0) AS packs_in_stock
FROM app.bundles b
LEFT JOIN app.stock_movements m ON b.id = m.bundle_id
WHERE b.is_active = true
GROUP BY b.id, b.name;

-- v_sales_invoice_balance
CREATE OR REPLACE VIEW app.v_sales_invoice_balance AS
SELECT 
    inv.id,
    inv.invoice_no,
    inv.invoice_date,
    inv.customer_id,
    inv.total,
    COALESCE(SUM(pa.amount_applied), 0) AS paid_applied,
    inv.total - COALESCE(SUM(pa.amount_applied), 0) AS balance_due
FROM app.sales_invoices inv
LEFT JOIN app.payment_allocations pa ON inv.id = pa.sales_invoice_id
GROUP BY inv.id;

-- v_purchase_invoice_balance
CREATE OR REPLACE VIEW app.v_purchase_invoice_balance AS
SELECT 
    inv.id,
    inv.invoice_no,
    inv.invoice_date,
    inv.supplier_id,
    inv.total,
    COALESCE(SUM(pa.amount_applied), 0) AS paid_applied,
    inv.total - COALESCE(SUM(pa.amount_applied), 0) AS balance_due
FROM app.purchase_invoices inv
LEFT JOIN app.payment_allocations pa ON inv.id = pa.purchase_invoice_id
GROUP BY inv.id;

-- v_customer_credit (Simulated)
CREATE OR REPLACE VIEW app.v_customer_credit AS
SELECT 
    c.id AS customer_id,
    c.name,
    0 AS credit_balance -- Placeholder: requires complex logic aggregating unallocated payments
FROM app.customers c;

-- v_supplier_advance (Simulated)
CREATE OR REPLACE VIEW app.v_supplier_advance AS
SELECT 
    s.id AS supplier_id,
    s.name,
    0 AS advance_balance -- Placeholder
FROM app.suppliers s;


-- 4. Functions (RPCs) - Minimal Placeholders for Compatibility

-- fn_next_invoice_no
CREATE OR REPLACE FUNCTION app.fn_next_invoice_no(p_series text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    prefix text;
    last_no text;
    new_no int;
BEGIN
    prefix := CASE WHEN p_series = 'sales' THEN 'INV-' ELSE 'PUR-' END;
    -- Logic to find last number and increment would go here.
    -- Simplified for schema generation:
    RETURN prefix || to_char(now(), 'YYYYMMDD-HHMISS'); 
END;
$$;

-- fn_create_sales_invoice_api
CREATE OR REPLACE FUNCTION app.fn_create_sales_invoice_api(
    p_invoice_no text,
    p_customer_id uuid,
    p_invoice_date timestamp with time zone
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    new_id uuid;
BEGIN
    INSERT INTO app.sales_invoices (invoice_no, customer_id, invoice_date)
    VALUES (p_invoice_no, p_customer_id, p_invoice_date)
    RETURNING id INTO new_id;
    RETURN new_id;
END;
$$;

-- fn_recalc_sales_invoice_totals
CREATE OR REPLACE FUNCTION app.fn_recalc_sales_invoice_totals(p_invoice_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE app.sales_invoices
    SET total = (SELECT COALESCE(SUM(line_total), 0) FROM app.sales_invoice_lines WHERE invoice_id = p_invoice_id)
        - discount + other_charges
    WHERE id = p_invoice_id;
END;
$$;

-- fn_create_purchase_invoice (Complex - Stubbed)
CREATE OR REPLACE FUNCTION app.fn_create_purchase_invoice(
    p_invoice_no text,
    p_supplier_id uuid,
    p_invoice_date timestamp with time zone,
    p_due_date timestamp with time zone,
    p_discount numeric,
    p_other_charges numeric,
    p_notes text,
    p_lines jsonb
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    new_inv_id uuid;
    line jsonb;
BEGIN
    -- 1. Create Invoice
    INSERT INTO app.purchase_invoices (invoice_no, supplier_id, invoice_date, due_date, discount, other_charges, notes, total)
    VALUES (p_invoice_no, p_supplier_id, p_invoice_date, p_due_date, p_discount, p_other_charges, p_notes, 0) -- Total recalc needed
    RETURNING id INTO new_inv_id;

    -- 2. Loop lines (simplified)
    -- In a real function you would iterate p_lines, insert to purchase_invoice_lines, and insert to stock_movements
    -- This requires dynamic SQL or jsonb looping in PL/PGSQL.
END;
$$;
