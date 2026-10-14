-- Run ONCE as DB owner AFTER migrations (deployment step, not a migration):
-- the application must NOT connect as superuser/table-owner, or RLS is bypassed.
--   psql "$OWNER_DATABASE_URL" -f apps/api/prisma/app-role.sql
-- Then set the app's DATABASE_URL to use erp_app.
DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='erp_app') THEN CREATE ROLE erp_app LOGIN PASSWORD 'CHANGE_ME'; END IF; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app;
