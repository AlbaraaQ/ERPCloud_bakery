-- Phase 5: manufacturing, lot genealogy, stock counts
CREATE TABLE boms (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, product_id UUID NOT NULL, name TEXT NOT NULL, version INT NOT NULL DEFAULT 1, is_active BOOLEAN NOT NULL DEFAULT true, UNIQUE (tenant_id, product_id, version));
CREATE TABLE bom_lines (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, bom_id UUID NOT NULL REFERENCES boms(id) ON DELETE CASCADE, ingredient_product_id UUID NOT NULL, qty_per_unit NUMERIC(19,6) NOT NULL, waste_percent NUMERIC(9,6) NOT NULL DEFAULT 0);
CREATE TABLE production_orders (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, number INT, bom_id UUID NOT NULL, product_id UUID NOT NULL, warehouse_id UUID NOT NULL, planned_qty NUMERIC(19,6) NOT NULL, good_qty NUMERIC(19,6), abnormal_scrap_qty NUMERIC(19,6) NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'planned', business_date DATE NOT NULL, finished_lot_id UUID, total_cost NUMERIC(19,4), unit_cost NUMERIC(19,4), journal_entry_id UUID, idempotency_key TEXT, created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (tenant_id, idempotency_key));
CREATE TABLE production_consumption (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE, product_id UUID NOT NULL, lot_id UUID, planned_qty NUMERIC(19,6) NOT NULL, actual_qty NUMERIC(19,6) NOT NULL, unit_cost NUMERIC(19,4) NOT NULL);
CREATE TABLE production_cost_components (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE, kind TEXT NOT NULL, amount NUMERIC(19,4) NOT NULL);
CREATE TABLE scrap_records (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, order_id UUID, product_id UUID NOT NULL, qty NUMERIC(19,6) NOT NULL, kind TEXT NOT NULL, amount NUMERIC(19,4) NOT NULL, reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE lot_genealogy (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, finished_lot_id UUID NOT NULL, raw_lot_id UUID NOT NULL, raw_product_id UUID NOT NULL, qty NUMERIC(19,6) NOT NULL, order_id UUID NOT NULL);
CREATE INDEX lot_genealogy_finished_idx ON lot_genealogy (tenant_id, finished_lot_id);
CREATE INDEX lot_genealogy_raw_idx ON lot_genealogy (tenant_id, raw_lot_id);
CREATE TABLE stock_counts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, warehouse_id UUID NOT NULL, status TEXT NOT NULL DEFAULT 'draft', business_date DATE NOT NULL, created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE stock_count_lines (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, count_id UUID NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE, product_id UUID NOT NULL, lot_id UUID, book_qty NUMERIC(19,6) NOT NULL, counted_qty NUMERIC(19,6) NOT NULL, reason TEXT);
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['boms','bom_lines','production_orders','production_consumption','production_cost_components','scrap_records','lot_genealogy','stock_counts','stock_count_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true) OR current_setting(''app.platform_access'', true) = ''on'') WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true) OR current_setting(''app.platform_access'', true) = ''on'')', t);
  END LOOP;
END $$;
