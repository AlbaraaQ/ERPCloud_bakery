# Invoicing & ZATCA / Tax Compliance

> **Compliance posture:** This document designs against ZATCA (FATOORA) Phase 2 concepts as
> generally published. **No endpoint, XML field, or cryptographic detail here is a compliance
> claim.** Exact implementation must follow the current official ZATCA SDK/specification at
> Phase 6 build time, be verified in the ZATCA sandbox, and receive legal sign-off (Q-001, Q-002).
> The system must never be described as "ZATCA-certified" merely because an API call succeeded.

## 1. Tax configuration (tenant)
Seller legal identity (legal name AR/EN, CR, VAT registration number, address), VAT status +
effective dates, invoice types enabled (standard / simplified), product tax categories & rates,
price tax-inclusiveness per price list, tax treatment policies: discounts, returns, free goods (Q-003).
Validation: posting a taxable document with missing/invalid tax config ⇒ blocking
`ConfigurationError` naming the missing item. **No rate is ever guessed; "buyer not VAT-registered"
never by itself removes seller obligations** — behaviour derives from seller status + transaction
type + configured policy.

## 2. Document types
Tax invoice (standard, B2B), simplified tax invoice (B2C), credit note, debit note — each linked
to its original where applicable. Commercial proforma/draft documents are visually and
systemically distinct and labelled «مسودة — ليست فاتورة ضريبية».

## 3. The Save dialog (both POS entry points)
Pressing Save shows an Arabic dialog with exactly two primary actions:

- **«حفظ وترحيل» (Save & Post):** validate permissions, stock availability, pricing/override
  approvals, customer credit, payments, tax config → persist + post inventory & accounting via
  shared services (one transaction) → run the required e-invoicing step for the document type →
  print copies per actual status. If the ZATCA step fails, the document keeps its exact tax
  status (`rejected`/`pending_*`), is **not** shown as cleared, and retry is idempotent.
- **«حفظ بدون ترحيل نهائي» (Save Without Final Posting):** saves a draft; no final stock/
  accounting effects (optional reservation only if tenant policy enables it); never represented
  as a tax invoice; editable by authorized users until posted; full audit trail.

**Legal guardrail:** choosing "Save" never opts out of a legal e-invoicing duty. If the
transaction is a taxable supply that must be issued, the workflow enforces issuance on posting;
a non-final document must not be used to conceal an issued taxable supply. Printed copies state
the real document type/status; for clearance-required invoices an uncleared print is never
presented as cleared.

Print copies: customer copy; representative/accountant acknowledgment copy (signature fields);
sale datetime + print datetime; line qty & free qty; totals; payment breakdown; outstanding
balance; original-invoice reference on returns/notes. Reprint logs an event, changes nothing.

## 4. ZATCA Phase 2 integration design (module `tax`, adapter boundary)
- Onboarding: CSR generation, compliance CSID request, compliance checks, production CSID —
  implemented strictly per official docs at build time; credentials/certificates encrypted at
  rest (secret store/KMS), sandbox vs production fully separated, never in git or logs.
- Per document: build UBL XML per official spec → hash → sign with production certificate →
  generate QR from the **actual** signed data → submit:
  - **Standard invoices:** clearance API first; only a `CLEARED` response marks `tax_status=cleared`.
  - **Simplified invoices & notes (per type rules):** reporting API within the legally required
    window; status `reported` only on real acceptance.
- Persist: invoice UUID, document hash, previous invoice hash chain (ICV/PIH per spec),
  submission id, status history, response codes; store response metadata (not secrets).
- Failures classified: validation (fix data, no blind retry), network/timeout (idempotent retry
  with same UUID/hash — never re-issue a new invoice for a retry), rejection (correction via
  credit/debit note per rules, never edit the submitted document).
- **Never fabricate** QR, stamp, clearance, or reference. Offline devices never claim clearance.

## 5. Tax calculation rules
Rate/category per line from product tax category (customer classification may affect place-of-supply
only per configured policy). Discounts allocate pro-rata per line unless policy states otherwise.
Returns reverse tax via credit note at original rate. Free goods: tax treatment = configured
policy (`tax_on_free_goods`: taxable-at-price / zero-rated-with-reason / out-of-scope) — default
is "block until configured", **not** assumed exempt (Q-003). Rounding: per-line to 2dp (halalas)
with invoice-level reconciliation, Decimal only.

## 6. Offline behaviour (with `OFFLINE_SYNC.md`)
Offline, the rep app creates **local drafts/commercial documents** with client numbering.
Depending on the tenant's legal configuration (Q-002), on reconnect the server posts and runs
the ZATCA step; simplified-invoice reporting deadlines are tracked with alerts. If a transaction
type legally requires clearance **before** delivery, offline issuance of that type is blocked
by policy and the UI says so — offline mode is never a compliance bypass.

## 7. Tax reporting
Tax-period summary (output/input by rate/category), submission status lists (pending/rejected/
failed), credit/debit note register with original references, reconciliation: tax summary vs
VAT accounts in GL must match; differences reported, never adjusted silently.
