# Operations Runbook

## Environments & configuration
- `dev` (docker-compose), `staging`, `production`. Required env: `DATABASE_URL`
  (application must connect as non-owner `erp_app`, see below), `SESSION_SECRET` (32+),
  `WEB_ORIGIN`, `BACKUP_ENCRYPTION_KEY` (32+), `BACKUP_DIR`. Optional: `ZATCA_BASE_URL`,
  `ZATCA_CLEARANCE_PATH`, `ZATCA_REPORTING_PATH` (from current official ZATCA docs),
  `GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_DRIVE_TOKEN_SECRET_REF`, AI provider keys by ref name.
- **Never** commit secrets/certificates. ZATCA sandbox and production credentials are separate.

## Database roles (critical)
Migrations and seeds run as the owner. The application must NOT: superusers and table
owners bypass Row-Level Security. After migrations, the owner runs
`apps/api/prisma/app-role.sql` (set a real password first), and the app's `DATABASE_URL`
uses `erp_app`. CI enforces this pattern for integration tests.

## Release procedure
1. CI green on the release commit (unit + typecheck + build + real-Postgres integration).
2. Take a verified backup (`POST /platform/backups`) and confirm status `verified`.
3. `npx prisma migrate deploy` (owner) — migrations are additive; never edit an applied one.
4. Apply `app-role.sql` if new tables were added (grants are idempotent).
5. Deploy API + web images; smoke: `/api/v1/health` 200, `/api/v1/health/ready` 200,
   login, one report. Rollback = previous images; DB rollback only via the documented
   restore procedure below (migrations are not auto-reversed).

## Backups & restore
- Default cadence every 4 hours (job worker / platform action), retention = latest 18
  verified (≈3 days — disclosed), plus optional daily/weekly tiers in deployment policy.
- A backup counts only when `verified` (artifact re-read + SHA-256 + decrypt check).
- Restore drill (quarterly and before launch): create backup → verify artifact →
  compare table row counts against live → restore into an ISOLATED database →
  run reporting reconciliations (trial balance 0, stock drift 0, valuation == GL).
  Production restore is platform-owner + second approver only, audit-logged.

## Monitoring
`/api/v1/health` (liveness), `/api/v1/health/ready` (DB), `POST /platform/health`
(jobs/backups freshness), dashboard counters for failed tax submissions and rejected
sync ops. Alert on: no verified backup within 2× cadence, failed jobs, rising sync conflicts.

## Incident notes
- Sync conflicts never auto-resolve money/stock: they surface in the dashboard for the accountant.
- Tax submission failures preserve the document and its pending/rejected status; retries reuse UUID/hash.
