# Progress

_Last updated: 2026-10-14 (Phase 1 session). Update this file at the end of every session._

## Current state
- **Phase:** 1 — Technical foundation (**substantially built; DB-backed integration pending CI/real Postgres**)
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

## Open items in Phase 1 before declaring it complete
- Run CI once (needs push authorization) or provide Postgres → then: migrate, seed, login E2E,
  cross-tenant integration test (AT-SEC-001 full), refresh-token rotation test.
- Lint (eslint) not yet configured — typecheck+tests are the current gate (root `lint` script says so).

## Files changed (this session)
Root scaffold (package.json, tsconfig.base, .env.example, .gitignore), `packages/shared/*`,
`apps/api/*` (src, prisma schema/migration/seed/app-role), `apps/web/*`, `.github/workflows/ci.yml`,
docs updates (README phase, DECISIONS D-013/D-014, SECURITY_AND_TENANCY RLS role note, this file).
No commits/pushes (per brief §18, not separately requested).

## Exact next step
1. Get Postgres: push branch to run CI **or** provide a DATABASE_URL → run migrate+seed+login E2E.
2. Then Phase 2: chart of accounts/mappings, journal engine, products/warehouses/movement ledger.
