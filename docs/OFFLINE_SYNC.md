# Offline-First & Synchronization (Representative App)

## 1. Principles
Offline-first means: the rep can keep selling within **documented, bounded** limits without a
connection; nothing is lost on restart; nothing posts twice on retry; the server — never the
device — is authoritative for price, tax, credit, stock, and posting.

## 2. Local storage
PWA with IndexedDB stores: cached catalogues (products/prices for permitted scope, customers,
own-warehouse stock snapshot, tax categories), local documents, and a **durable outbox**
(`local_ops`: client_op_id UUIDv4 generated at creation, type, payload, payload_hash, state,
attempts, last_error). Service worker caches app shell; versioned cache with update prompt.
Local data protected by device session lock (PIN/biometric where platform allows) and
encrypted-at-rest where the platform supports it; session expiry forces re-login but **never
deletes** the unsynced outbox.

## 3. Sync protocol
```mermaid
sequenceDiagram
  participant D as Device Outbox
  participant S as Sync API
  participant V as Domain Services
  D->>S: POST /sync/push {device_id, ops[{client_op_id, type, payload, hash}]}
  S->>S: Auth device; check (tenant, client_op_id) seen?
  alt new op
    S->>V: Validate & post via authoritative services
    V-->>S: document id / typed rejection
    S->>S: record sync_operations(status=applied/rejected/conflict, result)
  else duplicate
    S-->>D: return original result (no re-execution)
  end
  S-->>D: per-op ack {client_op_id, status, server_doc_id, error?}
  D->>S: GET /sync/pull?since=cursor (catalogue, prices, stock, credit, transfer notices)
```
Push is per-op transactional: one bad op never rolls back others; acks are per op; the device
marks ops `synced` only on server ack. Payload immutability: server stores `payload_hash`;
a retry with same `client_op_id` but different hash ⇒ `conflict` (possible tamper/bug),
never applied. Retry: exponential backoff + jitter (base 5s, cap 15min), manual "مزامنة الآن"
button, auto-sync on `online` event and app foreground. Dashboard shows counts by state
(pending/syncing/synced/rejected/conflict) with actionable Arabic error per op and a guided
resolution action (fix & resubmit as **new** op linked to the rejected one, or discard with reason — audited).

## 4. Conflict rules (business, not last-write-wins)
| Conflict | Rule |
|---|---|
| Stock insufficient at sync | Op rejected `INSUFFICIENT_STOCK`; doc held as server-side draft exception for accountant; rep notified; never force negative stock silently |
| Credit limit exceeded at sync | Rejected/held per tenant policy (`offline_credit_policy`): hold for accountant approval or reject with reason |
| Price outside current policy | If within the price list valid at **document business time**, accept; else require approval/ reject per policy; original vs current price recorded |
| Customer/product deactivated meanwhile | Reject with reason; accountant resolution path |
| Duplicate client_op_id, same hash | Return original result (idempotent success) |
| Same client_op_id, different hash | Conflict; quarantine; audit; never apply |
| Server document edited meanwhile | Field documents are device-owned until synced; server masters (prices/customers) win via pull; no field-level merging of financial documents |

## 5. Offline limits (tenant-configurable, bounded)
Cached stock snapshot + sales-since-snapshot estimate shown as "المتاح تقريباً"; config:
`max_offline_invoice_value`, `max_offline_credit_per_customer` (≤ server credit limit),
`max_offline_ops`, `max_offline_duration`. Exceeding a limit blocks **new** offline documents
with a clear message — limits never become unlimited. Oversell/over-credit discovered at sync
follows §4; repeated occurrences surface in rep performance/exception reports.

## 6. Recovery & integrity
On restart/reboot the outbox reloads from IndexedDB and resumes; crash mid-push is safe because
server dedupes by `client_op_id`. Device lost/revoked: admin revokes device; unsynced data on
it is unrecoverable by design (disclosed to users; sync-often guidance + pending-op warnings).
Clock skew: device timestamps are informational; server assigns posting timestamps and uses
device business datetime as claimed `device_business_at` — discrepancies > threshold flagged
in audit (matters for tax timing, see Q-002).

## 7. Platform limitations (disclosed)
iOS Safari PWA: background sync is unreliable/absent → sync on foreground/open + manual button;
storage eviction risk under pressure → persistent-storage request + prominent unsynced warnings;
push notifications best-effort → in-app notification centre is authoritative.
