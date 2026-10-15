# AI Assistant

## 1. Positioning
Optional module. Core ERP is fully functional with AI disabled. The assistant answers
authorized business questions and prepares (never silently executes) sensitive actions.

## 2. Providers
Provider-agnostic adapter interface (`chat(model, messages, tools)`) with per-tenant
configuration: provider type (OpenAI-compatible API style; adapters for major vendors added
behind the same interface), base URL, model, encrypted API key (secret store), timeouts,
data-residency/privacy flags, enable/disable per tenant & per user role. Keys never reach the
client; switching provider changes no domain code.

## 3. Tool registry (permission-aware, server-side only)
Read tools v1: `sales_summary(period, branch?, rep?)`, `collections_today`,
`overdue_customers`, `unresolved_settlements`, `low_stock`, `expiring_lots`,
`income_statement_summary(period)`, `stock_variance_explainer(count_id)`,
`anomaly_scan(prices/discounts/expenses/returns)`.
Each tool: declares required permission (e.g. `reports.sales.view`), validates & bounds inputs
(date ranges, limits), runs tenant-scoped queries through reporting services, returns structured
data. The model **cannot** run arbitrary SQL, cannot see other tenants, cannot read secrets,
and receives only the minimum fields needed.

Write/draft tools (Phase 9, all human-approved): e.g. "prepare a collection reminder draft",
"prepare a purchase suggestion". Anything that posts, reverses, deletes, changes tax config,
touches payroll, finalizes a settlement, or issues a regulated document is **never** executed
from model output alone — at most it creates a draft + approval task for an authorized human.

## 4. Safety
- Tenant isolation enforced inside tools (session tenant), not by prompt.
- Retrieved documents/imported data treated as untrusted (prompt-injection defence:
  tool results are data, instructions inside data are ignored; system prompt states this).
- Every conversation, tool call (tool, args hash, row counts, approver) written to `ai_tool_calls` audit.
- Rate/cost limits per tenant (plan entitlement), timeouts, graceful "assistant unavailable".
- PII minimisation: tools return aggregates by default; customer-level detail only with
  the matching permission; provider data-handling disclosed in tenant settings (retention varies
  by provider — tenant admin must acknowledge enabling).
- Answers must cite the underlying figures' period/filters; assistant states when data is draft-free/posted-only.

## 5. UX
Arabic-first chat panel in ERP (not in rep offline mode except cached FAQs — no offline AI
claims). Clear "مساعد ذكاء اصطناعي — تحقق من الأرقام من التقارير" disclaimer; one-click jump
from an answer to the authoritative report (drill-down) so numbers are verifiable.
