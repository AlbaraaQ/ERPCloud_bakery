# Van-Sales (Representative) Workflow

## 1. Provisioning (idempotent)
Admin: create/select `employee` → assign role `FIELD_REP` → create/link `user` → grant permissions.
On role assignment the system, in one transaction: creates `representative_profile` and exactly
one warehouse `kind=REP` linked to the employee (unique constraint on `warehouses.employee_id`
where kind=REP; re-assignment returns the existing warehouse — AT-REP-001). Scope configured:
branches, customer set/route, products, price policy, credit policy, expense categories.
Removing the role: profile deactivated; warehouse custody must be settled/returned first or
explicitly transferred by an approved custody-transfer document; **history is never deleted**.

## 2. Custody model
A representative holds custody = stock in REP warehouse + cash in their cash custody +
unsettled electronic payments + open customer receivables from their credit sales.
Expected balances are always derived from posted movements/documents, never typed in.

## 3. Stock transfer to representative
```mermaid
sequenceDiagram
  participant A as Accountant
  participant S as System
  participant R as Representative
  A->>S: Create & dispatch transfer (lots, qty)
  S->>S: stock_out source → in-transit; notify rep
  S-->>R: Notification: transfer pending receipt
  R->>S: Count & accept / partial / dispute (reason per line)
  alt accepted
    S->>S: stock_in REP warehouse (once only)
  else disputed
    S-->>A: Discrepancy task; resolution: approve shortage / recount / return
  end
```
Receipt is idempotent (retry safe); a transfer cannot be received twice; partial receipts keep
the remainder `in_transit/disputed` until resolved (INV rules in `INVENTORY_AND_COSTING.md` §5).

## 4. Field selling day
Representative uses the PWA POS (`OFFLINE_SYNC.md` for offline rules): customer-specific prices,
credit limit checks (cached limits offline — bounded, see OFFLINE_SYNC §5), free-goods lines per
policy, price overrides only within policy (else approval request), collections (cash / bank /
electronic with settlement state), returns to quarantine, expenses with photo attachment.
Every document carries the rep, device, client op id, business date, and sync state visibly.

## 5. Settlement request & reconciliation
Representative taps "طلب تسوية" → creates unique `settlement` (status `requested`), notifies
accountants. Reconciliation screen (all figures drillable to source docs):

- Opening custody (stock per product/lot, cash)
- + transfers accepted − sales (paid + free qty) − returns accepted back ± adjustments = **expected ending stock** vs **counted**
- Cash: opening + cash sales + collections − expenses(approved) − cash handed over = **expected cash** vs **counted/handed**
- Credit sales → receivables list; collections allocated
- Electronic payments by settlement state (pending ones listed, not treated as cash)
- Returns/damaged/expired/missing quantities; unresolved transfers, sync conflicts, rejected ops

## 6. Accountant review & discrepancy policy
Accountant counts stock, inspects returns/damage, reviews each expense + evidence, matches cash
handover, reconciles e-payments, may request recount/evidence, then: approve normal settlement,
or record discrepancies as **`settlement_exceptions`** (status `under_investigation`).
An exception is resolved only by an authorized decision: (a) approve inventory/cash adjustment
document (posts movement/journal), (b) approve a legally-valid employee receivable
(separate document, configured mapping, supporting decision attached), or (c) write off to
shortage loss. **Nothing auto-converts to employee debt; nothing auto-deducts from payroll**
(payroll deduction legality = Q-004, requires company policy + legal basis recorded).

Surpluses are documented and reconciled the same way — never silently absorbed.

## 7. Final closure gates
Settlement can finalize only when: stock counted/reconciled or exceptions approved; cash
reconciled or exceptions approved; e-payments have explicit status; expenses reviewed;
pending sync ops affecting the period resolved or explicitly handled per policy; all postings
succeeded. Finalization takes a row lock on the settlement (second accountant gets
"قيد الإنهاء بواسطة مستخدم آخر"); finalized settlement immutable except via linked
adjustment/reversal documents. Representative is notified of the outcome with final figures
and references (own data only).

## 8. Commissions
Configurable rules (e.g. % of collected sales by product/customer tier), calculated from
**collected** amounts by default (Q-009), adjustments audited, payable via payroll/cash per policy.
Commission never posts automatically from unapproved calculations.
