# Platform Owner Administration Console

Separate route/shell, platform authentication (MFA mandatory), independent authorization —
a tenant account can never reach it and vice versa.

## 1. Capabilities
- **Tenants:** create, activate, suspend, controlled deactivation; provisioning runs seed
  workflow (owner user, default roles, CoA template, fiscal year) as one auditable job.
- **Subscriptions & licensing:** plans (name, price placeholder Q-014, user/rep limits, storage
  quota, feature entitlements: manufacturing, ZATCA, AI, offline reps…), assignment, renewal
  dates, grace period, usage counters (users, representatives, invoices/month, storage).
  Entitlement checks enforced server-side (e.g. creating representative #N+1 beyond plan blocked).
- **Monitoring:** health (API/DB/jobs), background-job board (failed/retrying), sync error
  rates, ZATCA submission failure rates, backup status board (`BACKUP_AND_RECOVERY.md`),
  integration status, rate-limit/abuse controls (throttle or suspend abusive tenants/devices).
- **Platform audit log:** every console action (who, what, target tenant, reason).
- **Support access:** impersonation is **off by default**. Exceptional access requires:
  tenant-owner consent or documented legal basis, scope (read-only default; specific modules),
  expiry (≤ 8h default), reason/ticket; a banner shows the tenant that support access is active;
  every action during access is audit-logged under both identities. No silent browsing of
  customer financial records.

## 2. Tenant lifecycle rules
- **Suspension:** logins blocked (except owner export), data untouched, jobs paused per policy.
- **Subscription expiry:** grace period → read-only mode (view/export allowed, posting blocked)
  → suspension. Financial history is **never deleted** by expiry/suspension.
- **Deactivation/deletion:** only via documented workflow with retention check: legal retention
  period & holds (Q-010) must pass; deletion = export offered → cooling-off → anonymise/delete
  by approved job, fully audited. Platform owner alone cannot delete a tenant's financial
  history inside its retention period.

## 3. Operational controls
Feature flags per plan/tenant (kill-switches for AI, ZATCA submission, sync), maintenance
mode banner, announcement to tenants, environment/credential status views (values masked).

## 4. Separation guarantees
Platform tables have no `tenant_id` shortcuts into tenant data; any cross-tenant aggregate
(metrics) uses privacy-safe counts only. Platform compromise must not equal tenant-data access:
support-access workflow + audit are the only path, tested in AT-PLAT scenarios.
