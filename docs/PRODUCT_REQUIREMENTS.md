# Product Requirements

Scope: three applications sharing **one** authoritative backend and one set of business rules.

1. **ERP app** (accounting & operations, incl. fast back-office POS)
2. **Representative app** (mobile-first PWA, offline-first, incl. field POS)
3. **Platform console** (SaaS owner: tenants, subscriptions, backups, health)

Requirement IDs: `FR-<module>-<nnn>` functional, `NFR-<nnn>` non-functional.
Acceptance test IDs (`AT-…`) live in `TESTING_AND_ACCEPTANCE.md`.

---

## 1. Company setup & accounting foundations (ACC)

| ID | Requirement | Acceptance (summary) |
|---|---|---|
| FR-ACC-001 | Company profile, branches, warehouses, fiscal years, accounting periods | CRUD + audit; periods belong to a fiscal year |
| FR-ACC-002 | Configurable base currency, number/date formats, tenant time zone | Formats applied consistently in UI, print, reports |
| FR-ACC-003 | Chart of accounts + account groups, tenant-configurable | Seeded template (configurable), no hard-coded posting accounts |
| FR-ACC-004 | Opening balances & controlled opening stock (permission + audit) | Posts as dated opening journal/stock movements only |
| FR-ACC-005 | Manual general journal, balanced debit=credit | Unbalanced journal cannot post (DB + service check) |
| FR-ACC-006 | Posting permissions & approval workflow (draft → approved → posted) | Separation configurable; all transitions audited |
| FR-ACC-007 | Period close/reopen with authorization + audit history | Posting into closed period is rejected server-side |
| FR-ACC-008 | Reversals & debit/credit adjustments linked to originals | Original never edited/deleted; reversal cannot be duplicated |
| FR-ACC-009 | Financial dimensions: branch, warehouse, representative, cost center, project | Dimensions carried on journal lines where relevant |
| FR-ACC-010 | Configurable document numbering per type/branch/period | No duplicates, no silent reuse of a posted number (unique constraint) |
| FR-ACC-011 | Missing posting account ⇒ blocking configuration error naming the missing mapping | No account is auto-created silently |

## 2. Customers & suppliers (PARTY)

| ID | Requirement |
|---|---|
| FR-PARTY-001 | Customer/supplier profiles: contacts, addresses, tax registration, tax classification |
| FR-PARTY-002 | Customer-specific prices/discounts, credit limit, payment terms, credit hold |
| FR-PARTY-003 | AR/AP aging, customer & supplier statements |
| FR-PARTY-004 | Receipts/payments with allocation to documents; unallocated advances supported |
| FR-PARTY-005 | Returns, credit notes, debit notes, documented adjustments |
| FR-PARTY-006 | Duplicate detection; merge only via controlled, audited procedure (open question Q-006) |

## 3. Products & units (PROD)

| ID | Requirement |
|---|---|
| FR-PROD-001 | SKU + barcode (unique per tenant), Arabic + English names, categories, brands |
| FR-PROD-002 | Purchase/sales/stock units with conversion factors (e.g. carton ↔ piece, kg fractional) |
| FR-PROD-003 | Costing method per policy (see `INVENTORY_AND_COSTING.md`), tax classification per product |
| FR-PROD-004 | Optional batch/lot + expiry tracking per product; min/max stock levels |
| FR-PROD-005 | Price lists; activate/discontinue without deleting history |

## 4. Warehouses & inventory (INV)

| ID | Requirement |
|---|---|
| FR-INV-001 | Multiple warehouses/locations; representative warehouses are a typed kind |
| FR-INV-002 | Receipts, issues, inter-warehouse transfers: dispatch → in-transit → receive → discrepancy → accept |
| FR-INV-003 | Transfer cannot be received twice; partial receipt & disputed quantities are explicit states |
| FR-INV-004 | Stock reservations & availability (on-hand − reserved) checks |
| FR-INV-005 | Physical counts, adjustments (damage/expiry/missing/quarantine) with reason + approval |
| FR-INV-006 | Returned-goods inspection workflow before stock becomes sellable |
| FR-INV-007 | Movement ledger is authoritative; balances derived from/reconciled to it |
| FR-INV-008 | Negative stock prevented by default; exception needs explicit config + permission |
| FR-INV-009 | Concurrency: two sellers cannot sell the same available stock (locking/conditional update) |
| FR-INV-010 | FEFO/FIFO pick suggestion per configured policy |

## 5. Manufacturing (MFG)

| ID | Requirement |
|---|---|
| FR-MFG-001 | Bills of materials / recipes with ingredient qty + UoM + expected waste % |
| FR-MFG-002 | Production orders & batches; planned vs actual consumption variance |
| FR-MFG-003 | Raw-material issue, finished-goods receipt, WIP per costing model |
| FR-MFG-004 | Labour/overhead cost components when configured; **zero cost is never assumed** |
| FR-MFG-005 | Normal vs abnormal waste, finished-goods scrap, yield & variance analysis |
| FR-MFG-006 | Lot traceability raw → finished → customer delivery; recall report |
| FR-MFG-007 | Missing cost inputs/mappings block final costing with explicit error |

## 6. Sales, POS & invoices (SALE)

| ID | Requirement |
|---|---|
| FR-SALE-001 | Two entry points (back-office POS, representative POS), **same** posting services |
| FR-SALE-002 | Cash & credit sales; search by name/SKU/barcode; keyboard-fast entry |
| FR-SALE-003 | Walk-in customer where permitted; customer-specific prices/discounts |
| FR-SALE-004 | Free-goods lines (explicit), partial & multiple payment methods (cash/bank/electronic) |
| FR-SALE-005 | Returns & credit notes linked to original invoice; approved corrections only |
| FR-SALE-006 | Printable Arabic invoice; sales/collection history; salesperson attribution & commission hooks |
| FR-SALE-007 | Four independent status axes per document: commercial, inventory, accounting, tax ( + payment, sync) |
| FR-SALE-008 | Save dialog: **Save & Post** vs **Save Without Final Posting** (draft) — see `INVOICING_AND_ZATCA.md` §3. Draft never masquerades as a tax invoice |
| FR-SALE-009 | Reprint never re-issues/re-posts; reprint events logged; original timestamp preserved |

## 7. Pricing & free goods (PRICE)

| ID | Requirement |
|---|---|
| FR-PRICE-001 | Default/min/max selling price per product; effective-dated & customer-specific prices |
| FR-PRICE-002 | Representative price policy: allowed bounds, override permission, approval threshold |
| FR-PRICE-003 | Discount limits + approval levels; record original price, actual price, discount, approver, user, time, reason |
| FR-PRICE-004 | A representative selling price **never** mutates the master product price |
| FR-PRICE-005 | Free goods: explicit lines, policy, reason, approval threshold; stock & cost effects posted; tax treatment from configured policy (never assumed exempt) |

## 8. Purchasing (PUR)

Purchase orders (optional per tenant), goods receipts, supplier invoices, purchase returns/credit
notes, landed costs, price/quantity variances, supplier payments/allocations/advances, AP aging.
Every purchase document links to received stock and its journal.

## 9. Cash, banks & expenses (CASH)

Multiple cashboxes/bank accounts, transfers, receipts/payments/deposits/withdrawals, bank
reconciliation, electronic-payment transactions with **separate settlement state** (a card
selection ≠ settled cash), expense categories with attachments & approval limits,
representative cash custody, cash shortage/overage as documented adjustments.

## 10. Employees, payroll & commissions (HR)

Employee records & status, user/role linkage, salary structures & allowances, payroll periods
with approval & payslips, deductions & advances, configurable representative commissions with
adjustment audit. **Shortages never auto-become employee debt or salary deductions** — see
`VAN_SALES_WORKFLOW.md` §6 and Q-004.

## 11. Representative app (REP) — detail in `VAN_SALES_WORKFLOW.md`, `OFFLINE_SYNC.md`

Provisioning (role assignment idempotently creates exactly one linked representative warehouse),
transfer acceptance/discrepancy, field POS, collections, expenses, offline outbox with sync
dashboard, settlement request & shift closure.

## 12. Tax & ZATCA (TAX) — detail in `INVOICING_AND_ZATCA.md`

Tax configuration, standard/simplified invoices, ZATCA Phase 2 onboarding, XML, clearance
(standard) / reporting (simplified), QR & crypto stamp from real responses only, retry without
duplicate issuance, tax reports. **Sandbox-verified only until legal sign-off (Q-001/Q-002).**

## 13. Reports (RPT) — detail in `REPORTING_SPECIFICATION.md`

Accounting, sales/distribution, inventory/production, tax suites; every report reconciles to
ledgers, supports date/branch/warehouse filters, PDF/spreadsheet export, drill-down to source.

## 14. Platform console (PLAT) — detail in `PLATFORM_ADMIN.md`, `BACKUP_AND_RECOVERY.md`

Tenant lifecycle, plans/entitlements/quotas, usage & health monitoring, backups (4-hourly,
≥18 retained by default, Google Drive optional), audited support access, audit logs.

## 15. AI assistant (AI) — detail in `AI_ASSISTANT.md`

Multi-provider, permission-aware read tools by default, human approval for any sensitive action,
full audit, tenant isolation enforced server-side. Optional module; core ERP works without it.

## Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-001 | Money/quantities exact decimal end-to-end (DB `NUMERIC`, Decimal in code, no float) |
| NFR-002 | Every financial/stock mutation in a DB transaction; related effects atomic |
| NFR-003 | Idempotency keys on all client commands & external integrations; safe retries |
| NFR-004 | Structured logs, audit trail, health endpoint, job observability |
| NFR-005 | Versioned migrations only; never edit an applied migration |
| NFR-006 | Automated tests in CI; quality gates in `TESTING_AND_ACCEPTANCE.md` |
| NFR-007 | Backups verified by checksum; restore drills in isolated environment |
| NFR-008 | Arabic-first RTL UI, bilingual, light/dark, WCAG-conscious contrast, keyboard POS |
| NFR-009 | PWA offline: durable outbox, restart recovery, exponential backoff + jitter |
| NFR-010 | Secrets via environment/secret store; sandbox vs production ZATCA credentials separated |
| NFR-011 | Tenant isolation enforced in DB (RLS) **and** application layer; cross-tenant tests mandatory |
| NFR-012 | All timestamps stored UTC; business dates per tenant time zone (documented rules) |
