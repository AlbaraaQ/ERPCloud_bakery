-- Phase 2: accounting + inventory foundations
CREATE TABLE account_groups (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, UNIQUE (tenant_id, code));
CREATE TABLE accounts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, group_id UUID REFERENCES account_groups(id), code TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT true, UNIQUE (tenant_id, code));
CREATE TABLE account_mappings (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, purpose TEXT NOT NULL, account_id UUID NOT NULL, UNIQUE (tenant_id, purpose));
CREATE TABLE fiscal_years (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, name TEXT NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL);
CREATE TABLE accounting_periods (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, fiscal_year_id UUID NOT NULL REFERENCES fiscal_years(id), name TEXT NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL, status TEXT NOT NULL DEFAULT 'open', closed_by UUID, closed_at TIMESTAMPTZ);
CREATE TABLE document_sequences (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, doc_type TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '', last_number INT NOT NULL DEFAULT 0, UNIQUE (tenant_id, doc_type, scope));
CREATE TABLE journal_entries (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, number INT, business_date DATE NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'posted', source_type TEXT, source_id TEXT, idempotency_key TEXT, reversal_of_id UUID UNIQUE REFERENCES journal_entries(id), created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (tenant_id, idempotency_key));
CREATE INDEX journal_entries_tenant_date_idx ON journal_entries (tenant_id, business_date);
CREATE TABLE journal_lines (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE, account_id UUID NOT NULL REFERENCES accounts(id), debit NUMERIC(19,4) NOT NULL DEFAULT 0, credit NUMERIC(19,4) NOT NULL DEFAULT 0, branch_id UUID, warehouse_id UUID, representative_id UUID, cost_center TEXT, party_id UUID, CHECK (debit >= 0 AND credit >= 0), CHECK ((debit > 0) <> (credit > 0)));
CREATE TABLE units_of_measure (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, UNIQUE (tenant_id, code));
CREATE TABLE products (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, sku TEXT NOT NULL, barcode TEXT, name_ar TEXT NOT NULL, name_en TEXT, stock_unit_id UUID NOT NULL, costing_method TEXT NOT NULL DEFAULT 'moving_average', lot_tracked BOOLEAN NOT NULL DEFAULT false, expiry_tracked BOOLEAN NOT NULL DEFAULT false, is_active BOOLEAN NOT NULL DEFAULT true, tax_category TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (tenant_id, sku), UNIQUE (tenant_id, barcode));
CREATE TABLE product_units (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE, unit_id UUID NOT NULL, factor_to_stock NUMERIC(19,6) NOT NULL, kind TEXT NOT NULL, UNIQUE (tenant_id, product_id, unit_id, kind), CHECK (factor_to_stock > 0));
CREATE TABLE warehouses (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'main', employee_id UUID UNIQUE, is_active BOOLEAN NOT NULL DEFAULT true, UNIQUE (tenant_id, code));
CREATE TABLE lots (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, product_id UUID NOT NULL, code TEXT NOT NULL, expiry_date DATE, UNIQUE (tenant_id, product_id, code));
CREATE TABLE stock_movements (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, product_id UUID NOT NULL REFERENCES products(id), warehouse_id UUID NOT NULL REFERENCES warehouses(id), lot_id UUID, type TEXT NOT NULL, qty NUMERIC(19,6) NOT NULL, unit_cost NUMERIC(19,4) NOT NULL, value NUMERIC(19,4) NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL, idempotency_key TEXT, business_date DATE NOT NULL, created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (tenant_id, idempotency_key));
CREATE INDEX stock_movements_product_wh_idx ON stock_movements (tenant_id, product_id, warehouse_id);
CREATE TABLE stock_balances (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, product_id UUID NOT NULL REFERENCES products(id), warehouse_id UUID NOT NULL REFERENCES warehouses(id), lot_id UUID, qty NUMERIC(19,6) NOT NULL DEFAULT 0, value NUMERIC(19,4) NOT NULL DEFAULT 0, avg_cost NUMERIC(19,4) NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (tenant_id, product_id, warehouse_id, lot_id));
-- Journal balance enforcement (deferred): total debit must equal total credit and be > 0
CREATE OR REPLACE FUNCTION assert_journal_balanced() RETURNS trigger AS $$
DECLARE e UUID; d NUMERIC; c NUMERIC; BEGIN
  e := COALESCE(NEW.entry_id, OLD.entry_id);
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO d, c FROM journal_lines WHERE entry_id = e;
  IF d <> c THEN RAISE EXCEPTION 'Unbalanced journal entry %: debit % credit %', e, d, c; END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER journal_lines_balance_chk AFTER INSERT OR UPDATE OR DELETE ON journal_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_journal_balanced();
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['account_groups','accounts','account_mappings','fiscal_years','accounting_periods','document_sequences','journal_entries','journal_lines','units_of_measure','products','product_units','warehouses','lots','stock_movements','stock_balances'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true) OR current_setting(''app.platform_access'', true) = ''on'') WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true) OR current_setting(''app.platform_access'', true) = ''on'')', t);
  END LOOP;
END $$;
