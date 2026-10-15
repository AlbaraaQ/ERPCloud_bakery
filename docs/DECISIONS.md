# Decisions, Assumptions & Unresolved Questions

Status: `Decided` / `Assumed (revisable)` / `Open — needs owner or legal answer`.
Open questions **block** only the work noted; they never get silently invented answers.

## Decisions (D)
| ID | Decision | Rationale / alternatives rejected |
|---|---|---|
| D-001 | Greenfield build; reuse nothing | Repo contained only a 1-line README (verified 2026-10-14, commit `456b7b1`) |
| D-002 | Modular monolith (NestJS) over microservices | Small team, transactional accounting; split later only on measured need |
| D-003 | PostgreSQL 16 primary DB; shared schema + `tenant_id` + RLS | Strong constraints/transactions; schema-per-tenant rejected (migration/ops cost) |
| D-004 | TypeScript end-to-end; React+Vite PWA (one web codebase, role shells) | One language; PWA gives installable offline rep app without native stores |
| D-005 | Prisma Migrate for versioned migrations; raw SQL for RLS/special constraints | Auditability; never edit applied migrations |
| D-006 | DB-backed outbox/jobs first; Redis/BullMQ only if measured need | Fewer moving parts; retry/observability still required |
| D-007 | Money `NUMERIC(19,4)`, qty `NUMERIC(19,6)`, Decimal in code; floats forbidden for money/qty | Accounting correctness (NFR-001) |
| D-008 | Default costing: moving weighted average per product×warehouse; FIFO optional per policy | Bakery/distribution fit; see Q-007 |
| D-009 | Custody stock becomes sellable on **acceptance** by default (tenant-configurable) | Matches physical custody & dispute flow; Q-008 |
| D-010 | Six separate document status axes (commercial/inventory/accounting/payment/tax/sync) | Prevents "posted = cleared" class of bugs |
| D-011 | Backups default: every 4h, keep latest 18 (≈3 days) + optional daily/weekly tiers | Per brief; short window disclosed honestly (Q-013) |
| D-012 | AI optional & off by default; read-tools first; writes only as approved drafts | Safety, privacy, tenant trust |
| D-013 | App connects to Postgres as non-owner role `erp_app`; migrations run as owner (`apps/api/prisma/app-role.sql`) | RLS is bypassed by superusers/owners — verified empirically 2026-10-14 (embedded Postgres) |
| D-014 | Prisma client loaded lazily in API; engines generated in CI | Prisma engine download host unreachable in this sandbox (B-003) |

## Assumptions (A) — revisable, confirm at Phase 1 kickoff
| ID | Assumption |
|---|---|
| A-001 | First market: Saudi Arabia (ZATCA), Arabic-first; base currency SAR default, configurable |
| A-002 | Tenants are SMEs (≤ ~200 users, ≤ ~100 representatives each) at launch scale |
| A-003 | Hosting: single-region cloud VM/container + managed/external Postgres; no Docker in current dev sandbox |
| A-004 | Bakery/food flavour (expiry, recipes) is configuration, not a separate product — core stays generic manufacturing |
| A-005 | Notifications v1 = in-app centre (+ email optional); SMS/WhatsApp are later integrations |

## Unresolved questions (Q) — owner/legal answers required
| ID | Question | Blocks | Needed from |
|---|---|---|---|
| Q-001 | ZATCA: confirm taxpayer scope — which tenant types must do Phase 2 clearance vs reporting-only? Current official deadlines per invoice type? | Phase 6 design sign-off | Legal/tax advisor + official ZATCA docs |
| Q-002 | Offline issuance legality: may simplified invoices be issued offline & reported later (and within what window)? May standard (clearance) invoices ever be created offline? | Phase 4/6 offline tax flow | Legal/tax advisor |
| Q-003 | Free-goods VAT treatment for tenants (taxable value basis?) per current rules | Phase 3/6 free-goods posting | Tax advisor |
| Q-004 | Employee shortage → receivable & any salary deduction: legal basis, caps, written-consent requirements (Saudi labour law)? | Settlement exception → payroll path | Legal/HR |
| Q-005 | Multi-currency: needed at launch? FX gain/loss & revaluation policy? | Phase 3 scope | Owner |
| Q-006 | Customer/supplier merge rules: allowed when both sides have posted history? | FR-PARTY-006 | Owner/accounting |
| Q-007 | Costing: any tenant needing FIFO or standard-cost instead of moving average? | Phase 2 config scope | Owner |
| Q-008 | Custody availability on dispatch vs acceptance — per-tenant choice acceptable? | Phase 4 defaults | Owner |
| Q-009 | Commission basis: collected-only, invoiced, or hybrid? Clawback on returns? | Phase 4 commission rules | Owner/sales |
| Q-010 | Data retention periods (financial records, personal data) & tenant deletion rights per jurisdiction | Platform deletion workflow | Legal |
| Q-011 | Cash-flow report: direct method acceptable for v1? | Phase 7 | Accountant |
| Q-012 | Route planning / GPS visit tracking in scope? Privacy/consent implications | Rep app scope | Owner/legal |
| Q-013 | Backup targets: confirm RPO 4h / RTO 4h; budget for longer retention & off-site copy? | Phase 8 defaults | Owner |
| Q-014 | Subscription plans: pricing, limits, grace-period length, trial policy? | Phase 8 plans | Owner (business) |
| Q-015 | Arabic-Indic numerals (٠١٢٣) required anywhere, or Western digits everywhere? | UX defaults | Owner |
| Q-016 | E-payment gateways in scope at launch (e.g. mada/networks), and settlement file formats? | Cash/e-pay reconciliation depth | Owner |
| Q-017 | Payroll depth at launch: full payroll vs employee/commission records only? Attendance source? | HR module scope (Phase 3/10) | Owner/HR |
| Q-018 | Print requirements: thermal (80mm) POS printers, A4, or both? Arabic PDF font licensing? | Print templates Phase 3 | Owner |

## Change rule
When a Q is answered: record answer + date + source here, move to D/A, update the owning doc,
and note it in `PROGRESS.md`. Until then, implementation must use the safe/blocking behaviour
specified in the owning doc (e.g. block posting, never guess).
