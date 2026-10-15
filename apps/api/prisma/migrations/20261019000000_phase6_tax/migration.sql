-- Phase 6: tax / ZATCA integration boundary (no secrets stored; secret_ref is a store reference name)
CREATE TABLE zatca_credentials (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, environment TEXT NOT NULL, secret_ref TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'configured', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (tenant_id, environment));
CREATE TABLE tax_counters (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, environment TEXT NOT NULL, last_icv INT NOT NULL DEFAULT 0, last_hash TEXT, UNIQUE (tenant_id, environment));
CREATE TABLE tax_submissions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, document_type TEXT NOT NULL, document_id UUID NOT NULL, kind TEXT NOT NULL, environment TEXT NOT NULL, uuid UUID NOT NULL, icv INT NOT NULL, previous_hash TEXT, invoice_hash TEXT NOT NULL, qr_payload TEXT, xml TEXT, xml_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', submission_ref TEXT, response_code TEXT, attempts INT NOT NULL DEFAULT 0, last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (tenant_id, document_type, document_id, environment));
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['zatca_credentials','tax_counters','tax_submissions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true) OR current_setting(''app.platform_access'', true) = ''on'') WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true) OR current_setting(''app.platform_access'', true) = ''on'')', t);
  END LOOP;
END $$;
