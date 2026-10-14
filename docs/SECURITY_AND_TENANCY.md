# Security & Tenancy

## 1. Tenant isolation (defense in depth)
1. Every tenant table has `tenant_id NOT NULL` + FK; composite uniques include `tenant_id`.
2. Application: tenant context from the authenticated session only (client-supplied tenant id
   is ignored/rejected); all repositories require tenant context; a request without it fails closed.
3. Database: PostgreSQL Row-Level Security enabled on tenant tables with policy
   `tenant_id = current_setting('app.tenant_id')::uuid`; app sets it per transaction
   (`SELECT set_config('app.tenant_id', …, true)`; server-only `app.platform_access` for pre-auth
   login/provisioning lookups). **RLS is bypassed by superusers/table owners** — therefore the
   application connects as the non-owner role `erp_app` (`apps/api/prisma/app-role.sql`, applied
   by the DB owner after migrations; migrations themselves run as owner). Verified 2026-10-14
   via embedded-Postgres test: no-context role sees 0 tenant rows, tenant-context sees its own rows.
4. Tests: cross-tenant read/write attempts must fail (AT-SEC-…); isolation tests are release gates.
5. Files/attachments & exports are tenant-scoped signed URLs; backups tenant rules in
   `BACKUP_AND_RECOVERY.md`. Platform admins get **no implicit** tenant financial access
   (see `PLATFORM_ADMIN.md` support-access workflow).

## 2. Authentication
Argon2id password hashing (per-user salt, tuned params), login rate limiting + lockout,
secure httpOnly `Secure` `SameSite` cookies, short-lived access + rotating refresh tokens
(reuse detection revokes the family), optional TOTP MFA (required for Platform Owner and
recommended for Tenant Owner/Accountant), password reset via single-use expiring tokens,
session/device list with revocation. Representative devices registered (`devices`: id,
public key/cert fingerprint optional, last seen, revoked flag); revoked device tokens rejected server-side.

## 3. Authorization (RBAC + limits)
Permissions are fine-grained verbs per resource: `view/create/edit_draft/post/approve/reverse/
export/configure` (e.g. `sales.post`, `inventory.adjust`, `settlement.finalize`,
`period.reopen`, `tax.configure`). Seed roles: Platform Owner, Platform Ops Admin, Tenant Owner,
Accountant/System Manager, Sales Manager, Warehouse Manager, Production Manager, Cashier,
Field Sales Representative, Auditor (read-only). Tenants may compose custom roles from the
permission catalogue. **Enforcement is server-side on every operation** (NestJS guards +
service checks); hiding UI buttons is never the control. Approval limits (amount thresholds)
evaluated server-side. Representatives are additionally data-scoped: assigned customers,
own REP warehouse, permitted products/operations only.

## 4. Audit log
Append-only `audit_log` (actor, tenant, action, entity type/id, before/after JSON for
config & master data, ip, device, timestamp UTC). Mandatory events: login/MFA, permission &
role changes, tax config changes, price overrides (+approver), stock adjustments, settlement
approvals/exceptions, journal posting/reversal, period close/reopen, exports, AI tool calls,
platform support access, backup/restore actions. Audit rows cannot be edited via any app role.

## 5. Data protection
TLS everywhere (HSTS), encryption at rest via platform disk/KMS; secrets (DB creds, ZATCA
certificates/keys, Google OAuth tokens, AI API keys) in a secret manager / encrypted columns
with KMS envelope encryption — never in git, logs, or client bundles. PII minimised; AI data
rules in `AI_ASSISTANT.md`. Backups encrypted (BACKUP_AND_RECOVERY). Error messages to users
never leak SQL, stack traces, or other tenants' existence.

## 6. Input & API safety
Server-side validation (DTO schemas) on all inputs; server recomputes prices, totals, tax,
credit and stock availability — client values are hints only. CSRF protection for cookie auth,
CORS allowlist, rate limits (per user/device/IP; stricter on auth & sync), idempotency keys on
mutations, file-upload type/size checks + AV scanning hook for attachments, output encoding in
UI (XSS), parameterised queries only (ORM/raw SQL bound params).

## 7. Privacy & retention
Tenant data retention/deletion follows contract + legal holds (`PLATFORM_ADMIN.md` §5);
financial history is never hard-deleted by suspension/expiry. Personal data export/deletion
requests handled per applicable law (open legal item Q-010); access logged.

## 8. Secure SDLC gates
Dependency scanning + secret scanning in CI, migration review, security test suite
(authZ matrix, tenant isolation, IDOR checks) as release gate (`TESTING_AND_ACCEPTANCE.md`).
