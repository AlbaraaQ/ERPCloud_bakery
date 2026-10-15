# Testing & Acceptance

## 1. Strategy
Pyramid: unit (domain rules, Decimal money math, tax calc) → integration (API + real PostgreSQL,
migrations, RLS) → concurrency/sync simulations → E2E (Playwright; PWA offline via network
throttling/service-worker control) → ZATCA sandbox (credentialed env only).
Frameworks: Vitest, Playwright. CI runs all non-credentialed suites on every PR.
**Rules:** never weaken/skip a test to go green; a test not run is reported as not run;
pre-existing failures distinguished from regressions in `PROGRESS.md`.

## 2. Quality gates per phase
Typecheck + lint clean · unit+integration green · tenant-isolation suite green ·
accounting invariants suite green · migration up-grade tested from empty DB ·
(for release) E2E acceptance green, backup restore drill passed, ZATCA sandbox report attached.

## 3. Required acceptance scenarios (IDs traceable to requirements)
| ID | Scenario | Phase |
|---|---|---|
| AT-REP-001 | Create employee → assign FIELD_REP twice → exactly one REP warehouse linked | 4 |
| AT-REP-002 | Remove role → custody/history preserved; outstanding custody blocks or transfers formally | 4 |
| AT-TRF-001 | Dispatch → notify → accept; available custody per policy | 4 |
| AT-TRF-002 | Discrepancy & partial receipt; second receipt attempt rejected; dispute routed to accountant | 4 |
| AT-SALE-001 | Cash & credit sales post balanced journals + stock-out at correct cost | 3 |
| AT-SALE-002 | Free-goods line: stock/cost effect + configured tax treatment; zero-price ≠ auto-exempt | 3/6 |
| AT-PRICE-001 | Customer price applied; min/max enforced; unauthorized override rejected & logged | 3 |
| AT-PRICE-002 | Authorized override records original/actual/approver/reason; master price unchanged | 3 |
| AT-OFF-001 | Sell offline → kill/restart app → reconnect → synced exactly once (invoice, stock, journal) | 4 |
| AT-OFF-002 | Retry storms & duplicate push (same/different hash) → no duplicates; tamper → conflict | 4 |
| AT-OFF-003 | Offline oversell/over-credit resolved per policy with accountant exception path | 4 |
| AT-SET-001 | Normal settlement closes; figures drill to source docs | 4 |
| AT-SET-002 | Shortage → exception only; **no employee debt, no payroll deduction** without approved decision | 4 |
| AT-SET-003 | Two accountants finalize concurrently → one succeeds, other gets lock message | 4 |
| AT-ACC-001 | All journals balance; reversal linked, un-duplicable; posted doc immutable | 2 |
| AT-ACC-002 | Posting into closed period rejected; reopen audited | 2 |
| AT-ACC-003 | Missing account mapping → blocking ConfigurationError, nothing posted | 2 |
| AT-INV-001 | Concurrent sales of last unit → exactly one succeeds | 2/3 |
| AT-INV-002 | Balances reconcile to movement ledger (automated zero-drift check) | 2 |
| AT-MFG-001 | BOM production: raw issue, finished cost incl. labour/overhead, abnormal scrap expensed, lot genealogy | 5 |
| AT-MFG-002 | Missing cost input blocks completion with explicit error (never zero cost) | 5 |
| AT-INV-DOC | Draft vs posted vs returned vs rejected vs reversed invoice states across all axes | 3/6 |
| AT-TAX-001 | ZATCA sandbox: simplified reporting + standard clearance happy paths (credentialed) | 6 |
| AT-TAX-002 | ZATCA failure/timeout → status preserved, idempotent retry, no duplicate issuance, no fake QR/stamp | 6 |
| AT-DATE-001 | Business-date boundaries across tenant time zones (23:59/00:01 cases) | 2 |
| AT-SEC-001 | Cross-tenant read/write/export attempts all fail; rep sees only own scope | 1+ |
| AT-SEC-002 | Permission matrix: each role denied outside its verbs (server-side) | 1+ |
| AT-BAK-001 | Backup → checksum verify → Drive upload (test account) → isolated restore → reconciliations pass | 8 |
| AT-RPT-001 | Report totals vs ledger recomputation (trial balance, valuation, AR aging, tax summary) | 7 |
| AT-AI-001 | AI tools respect permissions & tenant; write actions require human approval; calls audited | 9 |
| AT-PLAT-001 | Plan limits enforced (reps/users); suspension preserves data & export | 8 |

## 4. Environments
`test` (ephemeral Postgres in CI), `staging` (ZATCA sandbox, Drive test folder, AI test keys).
This sandbox currently lacks Postgres/Docker (blocker B-001) — until resolved, DB-backed tests
run in CI or after installing Postgres; unit-only results must be labelled as such.

## 5. Evidence
Every phase report in `PROGRESS.md` lists commands actually executed + real outputs summary.
Coverage targets: domain services ≥ 85% line coverage; money/tax/inventory modules ≥ 95%.
