# Accounting Policy

## 1. Model
Double-entry, accrual basis. Every financial effect is a `journal_entry` with ≥2 lines,
Σdebit = Σcredit (tenant base currency, `NUMERIC(19,4)`), enforced by service validation
**and** a deferred DB constraint/trigger. Entries carry: business date, posting timestamp (UTC),
fiscal period, source (type,id), actor, approval state, optional `reversal_of_id`, idempotency key.

## 2. Chart of accounts
Tenant-owned, seeded from an editable template (assets/liabilities/equity/revenue/expenses),
grouped by `account_groups`. Posting code never references account codes directly — it references
**purposes** resolved through `account_mappings`, e.g.:

`AR_CUSTOMER, AP_SUPPLIER, SALES_REVENUE, SALES_RETURNS, VAT_OUTPUT, VAT_INPUT, INVENTORY,
COGS, FREE_GOODS_EXPENSE (policy), PRODUCTION_WIP, SCRAP_LOSS, CASH_ON_HAND, BANK, E_PAY_CLEARING,
REP_CASH_CUSTODY, EXPENSE_<category>, EMPLOYEE_RECEIVABLE (only via approved exception decision),
COMMISSION_EXPENSE/PAYABLE, OPENING_BALANCE_EQUITY`.

Missing mapping → `ConfigurationError: "لم يتم تكوين حساب [purpose]"`; posting blocked.
The system **never auto-creates** a posting account (FR-ACC-011).

## 3. Posting rules per document (summary; each row = one balanced template)

| Document | Debit | Credit | Inventory effect |
|---|---|---|---|
| Cash/credit sale (posted) | Cash/AR (gross) | Revenue (net), VAT output | out at cost: Dr COGS / Cr Inventory |
| Free-goods line | Free-goods expense or revenue-contra (policy Q-003) | — (with sale entry) | out at cost like paid lines |
| Sales return/credit note | Revenue returns, VAT output reversal | Cash/AR | in at original cost (after inspection state) |
| Supplier invoice | Inventory/purchases, VAT input | AP | in at receipt cost |
| Purchase return | AP | Inventory, VAT input reversal | out |
| Receipt from customer | Cash/Bank/E-pay clearing | AR (allocation) | — |
| Supplier payment | AP | Cash/Bank | — |
| Expense (approved) | Expense account, VAT input if applicable | Cash/Bank/payable | — |
| Production completion | Inventory–finished goods | WIP / raw materials / cost components | raw out, finished in |
| Scrap/abnormal waste | Scrap loss (approved) | Inventory/WIP | out |
| Settlement shortage (approved only) | Employee receivable **or** shortage loss (policy decision) | Inventory/Cash custody | per decision |
| E-payment settled | Bank/Cash | E-pay clearing | — (settlement is a separate event) |

Tax amounts come only from the tax engine (`INVOICING_AND_ZATCA.md`); inclusive/exclusive
pricing handled there. If tax policy is unconfigured for a taxable posting → blocked, not guessed.

## 4. Document → journal lifecycle
`draft → (approval if required) → posted → reversed`. Only posted entries affect ledgers/reports.
Editing a posted document is impossible; correction = reversal entry + new document, or
credit/debit note linked to the original. Reversal: new entry with swapped lines,
`reversal_of_id` set, unique constraint prevents double reversal; original marked `reversed`
but remains fully readable.

## 5. Periods & fiscal years
Posting validates business date ∈ open period. Close requires: no unposted approved docs
(configurable), period reports snapshot optional. Reopen needs `period.reopen` permission,
reason, audit entry. Opening balances post as a dated journal in the first period against
`OPENING_BALANCE_EQUITY`, permission `accounting.opening_balance`.

## 6. Numbering
Per document type (+ branch/period scope per tenant config), allocated **at posting** inside
the posting transaction from a locked sequence row. Unique `(tenant_id, doc_type, number)`.
Draft local numbers (field app) are a separate namespace (`OFFLINE_SYNC.md`) and are never
presented as posted/tax numbers.

## 7. Dates & time zones
Timestamps UTC. `business_date` = date in tenant time zone at moment of user action;
reports filter on `business_date` unless stated. Backdating allowed only with permission
and only into open periods; recorded in audit.

## 8. Dimensions & subledgers
Journal lines may carry branch/warehouse/representative/cost-center/project + party.
AR/AP control accounts reconcile to party subledgers (allocations); cash control reconciles
to cashbox/bank balances; inventory control reconciles to inventory valuation. Reconciliation
reports in `REPORTING_SPECIFICATION.md` must show zero unexplained difference.

## 9. Financial reporting basis
Trial balance / balance sheet / income statement / cash flow derive **only** from posted
journal lines (incl. reversals, excluding drafts). Comparative periods use business date.
See `REPORTING_SPECIFICATION.md` for formulas.
