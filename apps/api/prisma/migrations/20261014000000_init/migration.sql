-- ERPCloud Phase 1 foundation (hand-reviewed; generated-equivalent for schema.prisma)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE tenants (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active', base_currency TEXT NOT NULL DEFAULT 'SAR', timezone TEXT NOT NULL DEFAULT 'Asia/Riyadh', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE employees (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), full_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), email TEXT NOT NULL, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', mfa_secret TEXT, employee_id UUID UNIQUE REFERENCES employees(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (tenant_id, email));
CREATE TABLE roles (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), code TEXT NOT NULL, name TEXT NOT NULL, UNIQUE (tenant_id, code));
CREATE TABLE permissions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL UNIQUE);
CREATE TABLE role_permissions (role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE, permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE, PRIMARY KEY (role_id, permission_id));
CREATE TABLE user_roles (user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE, PRIMARY KEY (user_id, role_id));
CREATE TABLE sessions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, refresh_hash TEXT NOT NULL UNIQUE, device_id UUID, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE devices (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, label TEXT NOT NULL, revoked_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE audit_log (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID REFERENCES tenants(id), actor_user_id UUID, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, before JSONB, after JSONB, ip TEXT, device_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX audit_log_tenant_created_idx ON audit_log (tenant_id, created_at);
CREATE TABLE outbox_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID REFERENCES tenants(id), type TEXT NOT NULL, payload JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INT NOT NULL DEFAULT 0, next_retry_at TIMESTAMPTZ, last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX outbox_events_status_retry_idx ON outbox_events (status, next_retry_at);
CREATE TABLE background_jobs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID REFERENCES tenants(id), type TEXT NOT NULL, payload JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INT NOT NULL DEFAULT 0, max_attempts INT NOT NULL DEFAULT 5, next_retry_at TIMESTAMPTZ, last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE subscription_plans (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, max_users INT NOT NULL DEFAULT 10, max_representatives INT NOT NULL DEFAULT 5, features JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE tenant_subscriptions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL UNIQUE, plan_id UUID NOT NULL, status TEXT NOT NULL DEFAULT 'active', renews_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
-- Row-Level Security (D-003): tenant tables fail closed unless tenant context or server-only platform context is set.
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['employees','users','roles','sessions','devices','audit_log','outbox_events','background_jobs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true) OR current_setting(''app.platform_access'', true) = ''on'') WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true) OR current_setting(''app.platform_access'', true) = ''on'')', t);
  END LOOP;
END $$;
