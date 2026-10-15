# Reporting Specification

**Global rules:** Reports read **only** authoritative ledgers (posted journals, stock movements,
posted documents). Drafts are excluded unless a report explicitly offers "include drafts"
(clearly labelled, never in financial statements). Reversals net against originals (no double
count). Filters everywhere: date range (on `business_date`), branch, warehouse, + report-specific
filters. Every total must drill down to source documents. Export PDF (Arabic RTL) & XLSX.
Currency formatting per tenant config. Each report lists: sources, formula, status treatment.

## Accounting
| Report | Formula / source | Notes |
|---|---|---|
| General ledger | Posted journal lines per account, opening + movements + closing | Drill to entry & source doc |
| Trial balance | Σdebit/Σcredit per account from posted lines | Must balance; period filter |
| Balance sheet | Assets = Liabilities + Equity (account types, posted, ≤ date) | Comparative prior period |
| Income statement | Revenue − expenses per period (posted) | By branch/cost-center dimension |
| Cash flow | Cash-account movements classified operating/investing/financing (mapping-driven) | Direct method v1 (Q-011) |
| Journal report | All entries by date/type/source with status | Includes reversals flagged |
| Account statement | Running balance per account/party dimension | — |
| AR/AP aging | Open allocated balances bucketed by due date (current/30/60/90+) | From subledger allocations |
| Customer/supplier statement | Invoices, notes, payments, allocations, balance | Printable, shareable |
| Cashbox/bank balances | Posted cash movements per account | Reconciles to GL cash accounts |
| Bank reconciliation | Bank statement lines vs posted movements; unmatched lists | Difference must be 0 to close |
| Expense analysis | Posted expenses by category/branch/approver | Attachment presence flagged |
| Profitability | Revenue − COGS − allocated costs by product/customer/branch/rep | Only where cost allocation is configured; method disclosed on report |

## Sales & distribution
Sales by date/product/customer/branch/representative (qty, free qty separate, gross, discount,
net, tax, collected, outstanding); cash vs credit mix; returns & discount analysis; free-goods
qty & **cost**; price-override log (incl. rejected attempts); collections; outstanding receivables;
rep performance & commission; custody & settlement history; shortages/overages & unresolved
exceptions; route/visit report (only if route feature enabled — Phase 4+, Q-012).

## Inventory & production
Stock on hand & available (by warehouse/lot/expiry); movement ledger report (any filter,
running balance); valuation (qty × current avg/FIFO value, reconciles to GL inventory);
slow/non-moving (no movement in N days); low-stock vs min level; lot/expiry (expired,
expiring ≤ N days); damaged/expired write-offs; production output & yield
(actual vs BOM expected); raw consumption; scrap/waste (normal vs abnormal, cost);
manufacturing cost & variance per order; traceability/recall (raw lot → finished lots →
invoices/customers, and reverse).

## Tax
Taxable sales by rate/category; output/input VAT summary per tax period; invoice issuance &
submission status (cleared/reported/pending/rejected/failed with age); credit/debit note register
with original references; tax-period reconciliation (report vs GL VAT accounts; differences listed).

## Reconciliation invariants (automated checks, alert if ≠ 0)
GL inventory control vs valuation total · AR control vs subledger · AP control vs subledger ·
cash control vs cashbook balances · Σ stock balances vs Σ movements · tax summary vs VAT GL ·
settlement expected vs source-document recomputation.
