-- Phase 9: AI assistant (provider configs hold secret REFERENCES only; tool calls fully audited)
CREATE TABLE ai_provider_configs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, provider TEXT NOT NULL, base_url TEXT NOT NULL, model TEXT NOT NULL, secret_ref TEXT NOT NULL, is_enabled BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (tenant_id, provider));
CREATE TABLE ai_tool_calls (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, user_id UUID NOT NULL, tool TEXT NOT NULL, args_hash TEXT NOT NULL, permission TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'executed', result_summary TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX ai_tool_calls_tenant_user_idx ON ai_tool_calls (tenant_id, user_id, created_at);
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['ai_provider_configs','ai_tool_calls'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true) OR current_setting(''app.platform_access'', true) = ''on'') WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true) OR current_setting(''app.platform_access'', true) = ''on'')', t);
  END LOOP;
END $$;
