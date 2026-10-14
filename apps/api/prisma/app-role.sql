-- Run ONCE as DB owner AFTER migrations (deployment step, not a migration):
-- the application must NOT connect as superuser/table-owner, or RLS is bypassed.
--   set a real password first: replace CHANGE_ME, then
--   psql "$OWNER_DATABASE_URL" -f apps/api/prisma/app-role.sql   (or prisma db execute --file)
-- Then set the app's DATABASE_URL to use erp_app with that password.
DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='erp_app') THEN CREATE ROLE erp_app LOGIN; END IF; END $$;
ALTER ROLE erp_app PASSWORD 'CHANGE_ME';
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app;
