# Progress

_Last updated: 2026-10-14 (Phase 1 session). Update this file at the end of every session._

## Current state
- **Phase:** 1–5 **COMPLETE** (latest CI green run 38656704921). Remaining: 6 (ZATCA), 7 (reporting), 8 (platform/backups), 9 (AI), 10 (hardening/release).
- **Phase 0:** complete (docs package, owner said "ابدأ العمل" 2026-10-14 lifting the doc gate)

## Completed — Phase 1 (evidence-based)
1. Monorepo (npm workspaces): `apps/api` (NestJS), `apps/web` (React+Vite), `packages/shared`.
2. `packages/shared`: Decimal money + `assertBalanced`, permission catalogue + role matrix
   (8 roles), six status axes (D-010), typed domain errors. Tests: 2/2 pass.
3. API foundation: env validation (zod, fails fast), health (`/health` ok; `/health/ready`
   honestly 503 without DB), Argon2id password hashing, opaque session tokens (SHA-256 hashed
   in DB, httpOnly cookie, tokens never in response body), tenant provisioning service
   (tenant+owner+roles+permissions+audit in one transaction), RBAC `PermissionsGuard` +
   pure `hasPermissions`, audit service, DB-outbox/jobs skeleton with exponential backoff+jitter.
   API unit tests: 6/6 pass (password, RBAC matrix skeleton AT-SEC-002, backoff).
4. Prisma schema (13 foundation models) + hand-reviewed initial migration SQL with RLS
   policies on all tenant tables + `app-role.sql` (app must connect as non-owner `erp_app`, D-013).
5. **RLS empirically verified** with embedded Postgres (PGlite, local substitute only):
   migration applies; non-owner role with no tenant context sees **0** rows; with tenant
   context sees its **1** row. Superuser bypass discovered & documented (SECURITY_AND_TENANCY §1).
6. Web shell: Arabic-first RTL, English toggle, light/dark themes, login form wired to API
   via Vite proxy, health indicator. Builds clean.
7. CI workflow (`.github/workflows/ci.yml`): Postgres 16 service → prisma generate → migrate
   deploy → typecheck → tests → build. **Not yet executed** (no push requested/performed).
8. Live smoke in sandbox: API boots, `GET /api/v1/health` = ok, web serves and proxies API.

## Tests executed (actual results)
- shared: `vitest` 2 passed. api: `vitest` 6 passed. web/shared typecheck: clean. api build: clean.
- Migration+RLS: PGlite run — MIGRATION_OK, RLS_NO_CONTEXT=0, RLS_WITH_CONTEXT=1.
- **Not run:** Prisma generate/migrate against real Postgres, seed, login end-to-end, CI.
  Reason: no Postgres/Docker locally and Prisma engine host unreachable (B-001/B-003).

## Blockers
| ID | Blocker | Impact | Resolution |
|---|---|---|---|
| B-001 | No PostgreSQL/Docker in sandbox | Real DB integration untested locally | CI (push when authorized) or provide Postgres |
| B-003 | binaries.prisma.sh unreachable from sandbox | `prisma generate` cannot run locally (D-014 workaround in place) | CI / DB-capable machine |
| B-002 | ZATCA sandbox/legal answers (Q-001/Q-002) | Phase 6 only | Owner/legal |

## Phase 1 completion evidence (2026-10-14, user authorized push-per-phase)
- CI run 38651921119 SUCCESS: npm ci → shared build → prisma generate → migrate deploy (Postgres 16)
  → typecheck → unit tests → integration tests as non-owner `erp_app` → full build.
- Integration verified on real Postgres: tenant provisioning, owner login + permission set
  (no platform.admin), wrong-password rejection, cross-tenant login isolation, RLS tenant scoping.
- CI debugging history (kept honest): Prisma one-line block syntax fix, base_currency @map fix,
  superuser-RLS-bypass fix (erp_app role). Remaining Phase-1 debt: eslint not configured;
  refresh-token rotation endpoint not yet implemented (sessions exist; rotation in Phase 3 hardening).

## Files changed (this session)
Root scaffold (package.json, tsconfig.base, .env.example, .gitignore), `packages/shared/*`,
`apps/api/*` (src, prisma schema/migration/seed/app-role), `apps/web/*`, `.github/workflows/ci.yml`,
docs updates (README phase, DECISIONS D-013/D-014, SECURITY_AND_TENANCY RLS role note, this file).
No commits/pushes (per brief §18, not separately requested).

## Exact next step
1. Get Postgres: push branch to run CI **or** provide a DATABASE_URL → run migrate+seed+login E2E.
2. Then Phase 2: chart of accounts/mappings, journal engine, products/warehouses/movement ledger.

## Phase 2 completion evidence (2026-10-15)
- CI run 38652363821 SUCCESS incl. real-Postgres integration (as erp_app):
  AT-ACC-001 balanced journal posts once under idempotency retry; trial balance = ledger;
  reversal linked + second reversal rejected; AT-ACC-003 missing mapping blocks with
  ConfigurationError; inventory moving-average issue cost = 3 (avg of 2/4), movement retry
  not duplicated, oversell blocked, **concurrent issues of last stock: exactly 1 succeeded**,
  balance↔ledger reconciliation drift = [].
- Local: 10/10 unit tests pass; both migrations also applied on embedded Postgres and the
  deferred journal-balance DB trigger verified to reject an unbalanced entry.
- Known gaps carried forward: AT-DATE-001 timezone-boundary test not yet written (Phase 3);
  FIFO costing not implemented (moving average only, per D-008/Q-007); transfers/counts/
  reservations are Phase 4/5 scope; accounting UI screens land with Phase 3 POS work.

## Phase 3 completion evidence (2026-10-15)
- CI run 38653388414 SUCCESS incl. Phase-3 integration on real Postgres:
  AT-SALE-001 cash sale (total 115 incl. 15% VAT, stock 100→90, idempotent repost);
  AT-SALE-002 free goods (5 paid + 2 free → stock −7, cost via FREE_GOODS_EXPENSE);
  AT-PRICE-001/002 out-of-bounds price rejected, approved override recorded
  (original 10 vs actual 11), master price unchanged; credit-limit rejection;
  draft purity (no stock/accounting effect) then post-draft; credit-note return
  restores stock at original cost; posting outside a fiscal period blocked;
  receipt moves party balance exactly −20; trial balance debit=credit; zero stock drift.
- Architecture: sales/purchasing compose document+stock+journal in ONE DB transaction
  via new Tx variants of Accounting/Inventory services (single-authority rule kept).
- Carried gaps: POS web panel is a UI shell (live data wiring needs DB env); tax engine is
  rate-per-product only — full ZATCA is Phase 6 (Q-001/Q-002/Q-003 still open); supplier
  payments use CashService.postPayment; bank reconciliation UI is Phase 7 reporting scope.

## Phase 4 completion evidence (2026-10-15)
- CI run 38655564074 SUCCESS incl. Phase-4 integration on real Postgres:
  AT-REP-001 double role assignment -> exactly one rep warehouse; transfer dispatch
  notifies rep, custody sellable only after acceptance; partial accept 45 + dispute 5,
  over-receipt rejected (cannot receive twice), approved shortage closes transfer
  (resolvedQty tracking added via new migration); AT-OFF: offline sale syncs once,
  duplicate push returns original doc, tampered payload = conflict (never applied),
  oversell op rejected, zero stock drift; AT-SET: normal settlement finalizes,
  shortage blocks closure as exception with **zero** employee-debt journals,
  approved adjustment posts stock+journal, then closure succeeds.
- Web: real IndexedDB outbox (client op ids, states, sync-now, backoff helper) wired
  to /representatives/sync/push.
- Debugging honesty: two real bugs were caught by CI tests and fixed — dispute
  resolution could never close a transfer, and decided exceptions spawned fresh
  open exceptions at finalize (infinite block).
- Carried gaps: commissions engine basic scope deferred (rules Q-009 open);
  settlement expected-cash covers cash allocations to rep invoices (e-payment
  settlement reconciliation UI is Phase 7); PWA background sync limitations per OFFLINE_SYNC §7.

## Phase 5 completion evidence (2026-10-15)
- CI run 38656704921 SUCCESS incl. Phase-5 integration on real Postgres:
  AT-MFG-002 missing PRODUCTION_OVERHEAD mapping blocks completion and posts nothing
  (order stays planned); AT-MFG-001: material 134 (52kg flour @2 + 10kg sugar @3)
  + labour 100 = 234 total, abnormal scrap 5 units = 11.7 expensed to SCRAP_LOSS,
  finished 95 @ 2.34, idempotent re-completion, lot genealogy flour-lot -> bread-lot,
  variance flour planned 50 vs actual 52 (+2), trial balance balanced, zero stock drift.
- Stock counts: counted 38 vs book 40 with reason posts adjustment movement+journal;
  FEFO returns earliest-expiry lot first.
- All 6 migrations also applied cleanly on embedded Postgres (59 tables).
- Carried gaps: FIFO costing still not implemented (D-008/Q-007 open); WIP is direct
  completion costing (no multi-stage WIP ledger); production UI screens are Phase 10 UX scope.
