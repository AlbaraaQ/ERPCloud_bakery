# Release Readiness Report (2026-10-15) — evidence-based, not a marketing claim

## Verified by automated tests on real PostgreSQL 16 (CI, this branch)
Phases 1–10 incl.: tenant isolation + RLS as non-owner role, Argon2id auth, refresh
rotation with replay rejection, HTTP E2E (health/login/protected routes), balanced
double-entry with DB trigger, reversals, period blocking, missing-mapping blocking,
moving-average costing, concurrent stock issue (exactly one wins), party/tax/sales/
purchasing/cash flows with exact amounts, representative provisioning/transfers/
offline sync (duplicate + tamper cases), settlement exception policy (no automatic
employee debt), manufacturing costing/scrap/genealogy, reporting reconciliation
(all differences zero), platform quotas/suspension/support-consent, encrypted backup
creation + verification + corruption detection + restore drill (row-count match),
AI tool permissions/audit/tenant isolation, rate limiting + password policy.

## NOT verified — must not be claimed
1. **ZATCA production compliance**: only the integration boundary + fake-gateway flows
   are tested. No real sandbox onboarding (CSR/CSID), no official-spec XML validation,
   no legal sign-off. Q-001/Q-002/Q-003 open. Production tax submission stays disabled.
2. **Legal/business answers open**: Q-004 (payroll deductions), Q-005 (multi-currency),
   Q-009 (commissions), Q-010 (retention), Q-013/Q-014 (backup targets, plan pricing),
   Q-016/Q-017 (payment gateways, payroll depth).
3. **Google Drive**: OAuth linking needs deployment credentials; unconfigured = explicit failure.
4. **Backups**: implemented mechanism is encrypted logical export (tested). Production
   should add pg_dump + object storage per BACKUP_AND_RECOVERY.md before launch.
5. **Browser E2E/print/PWA install**: web builds and is API-wired; Playwright browser
   suites, thermal/A4 print QA, and on-device PWA offline testing (iOS limits) remain.
6. **Load testing**: concurrency correctness is tested; throughput/load profiles are not.
7. **eslint** is not yet configured; typecheck + tests + CI are the enforced gates.

## Recommendation
Internal pilot with a friendly tenant (non-production tax mode) is reasonable.
Production launch is **not** recommended until items 1–4 are closed with evidence.
