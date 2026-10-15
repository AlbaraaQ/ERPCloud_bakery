# ERPCloud — Cloud Accounting ERP for Manufacturers & Van-Sales Distribution

> **Project vision:** A reliable, production-oriented, multi-tenant cloud accounting and
> operations platform for small/medium manufacturers, food factories, wholesalers,
> distributors, and van-sales (field representative) businesses. It provides one auditable
> lifecycle: production → warehouse transfers → sales → collections → returns → expenses →
> representative settlement → financial statements → tax compliance.

**Primary UI language:** Arabic (full RTL). **Secondary:** English. Light + dark themes.

**Guiding priority order (never trade a higher item for a lower one):**
accounting correctness → inventory accuracy → data integrity → tenant isolation →
recoverability → regulatory compliance → ease of use → feature speed.

---

## Current phase

| Item | Value |
|---|---|
| Phase | **All phases 0–10 implemented** — see `PROGRESS.md` and `RELEASE_READINESS.md` |
| Status | Full pipeline green in CI on real PostgreSQL; production launch gated on RELEASE_READINESS.md items |
| Repository state at assessment | Greenfield: single commit `456b7b1`, only `README.md`. Nothing to reuse, nothing to migrate. |
| Next step | Close legal/ZATCA/deployment items in RELEASE_READINESS.md, then pilot |

## Documentation index

| File | Purpose |
|---|---|
| `README.md` | This file: vision, index, how to resume work |
| `PRODUCT_REQUIREMENTS.md` | Business requirements (FR/NFR IDs) + acceptance criteria |
| `DOMAIN_MODEL.md` | Entities, relationships, invariants, terminology (AR/EN glossary) |
| `SYSTEM_ARCHITECTURE.md` | Stack, module boundaries, deployment, integration contracts |
| `ACCOUNTING_POLICY.md` | Chart of accounts, double-entry, posting, reversals, periods, reports |
| `INVENTORY_AND_COSTING.md` | Warehouses, movement ledger, costing, lots/expiry, production, free goods, scrap |
| `VAN_SALES_WORKFLOW.md` | Representative lifecycle, custody, transfers, settlement, shift closure |
| `INVOICING_AND_ZATCA.md` | Invoice state axes, tax policy, ZATCA Phase 2, offline tax behaviour |
| `SECURITY_AND_TENANCY.md` | Tenant isolation, RBAC, audit, encryption, secrets, privacy |
| `OFFLINE_SYNC.md` | Local storage, outbox, sync protocol, idempotency, conflicts, recovery |
| `REPORTING_SPECIFICATION.md` | Every report: formula, sources, filters, drill-down, reconciliation |
| `AI_ASSISTANT.md` | Providers, permission-aware tools, approvals, audit, privacy |
| `BACKUP_AND_RECOVERY.md` | Backup policy, Google Drive, retention, integrity, restore drills |
| `PLATFORM_ADMIN.md` | Tenants, subscriptions, licensing, quotas, monitoring, owner privileges |
| `UX_AND_DESIGN_SYSTEM.md` | Arabic-first RTL, bilingual, themes, components, accessibility |
| `TESTING_AND_ACCEPTANCE.md` | Test strategy, acceptance scenarios (AT-IDs), quality gates |
| `IMPLEMENTATION_ROADMAP.md` | Phases 0–10, dependencies, milestones, completion criteria |
| `DECISIONS.md` | Decision log (D-IDs), assumptions (A-IDs), **unresolved questions (Q-IDs)** |
| `PROGRESS.md` | Live status: done / pending / tests / blockers / exact next step |

Diagrams are Mermaid source inside the Markdown files (editable as text).

## How to resume work in a new session (mandatory)

1. Read `docs/README.md`, `docs/PROGRESS.md`, `docs/IMPLEMENTATION_ROADMAP.md`, `docs/DECISIONS.md`.
2. Run `git status` / `git log --oneline -10`; inspect what actually exists.
3. Verify code & tests against `PROGRESS.md` claims — never trust the document blindly.
4. Resume from the first incomplete task in `PROGRESS.md`; do not redo completed work.
5. At session end: update `PROGRESS.md` (tasks, files, tests **actually run** + results,
   defects, migration status, next action). Never mark a task complete merely because code exists.
6. If implementation changes a decision/contract/workflow, update the owning doc + `DECISIONS.md` in the same change.

## Repository assessment summary (2026-10-14)

- `git log`: one commit (`456b7b1 Initial commit`); tracked files: only `README.md` (1 line).
- No source code, no dependencies, no migrations, no database, no CI, no tests exist.
- Therefore: **greenfield build**. "Reuse vs rewrite" decision = build new, following
  `SYSTEM_ARCHITECTURE.md`. No data preservation/migration risk exists today (see `DECISIONS.md` D-001).
- Sandbox tooling observed: Node v22.22.3, npm 10.9.8, Python 3.11.2. **No PostgreSQL, no Docker**
  in this sandbox → local DB verification needs an external/CI Postgres or an installed
  Postgres before Phase 1 DB tests can run (recorded as blocker B-001 in `PROGRESS.md`).

## Non-negotiable rules (summary; details in owning docs)

- Server never trusts client-supplied prices, totals, tax, tenant ID, or stock balances.
- Money/quantities: exact decimals (`NUMERIC` / Decimal), never binary floating point.
- Posted documents are immutable; corrections happen via reversal/credit/debit notes.
- Offline retries must never duplicate invoices, payments, stock movements, or journals (idempotency keys).
- If a required account mapping / tax policy / costing input is missing → explicit blocking
  configuration error. **Never** invent an account, a tax rate, or a zero production cost.
- Tax status, accounting status, inventory status, and document status are **separate axes**.
- No secrets, certificates, or credentials in source control. Ever.
