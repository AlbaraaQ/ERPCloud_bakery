/** Durable offline outbox (OFFLINE_SYNC.md): IndexedDB, stable client op ids, survives restarts.
 *  States: pending -> syncing -> synced | rejected | conflict. Server dedupes by clientOpId. */
export interface LocalOp { clientOpId: string; type: string; payload: unknown; state: string; attempts: number; lastError?: string; createdAt: number; }
const DB = 'erpcloud-rep'; const STORE = 'outbox';
function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'clientOpId' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((res, rej) => { const req = fn(db.transaction(STORE, mode).objectStore(STORE)); req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}
export const newClientOpId = () => (crypto.randomUUID ? crypto.randomUUID() : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`);
export async function enqueue(type: string, payload: unknown): Promise<LocalOp> {
  const op: LocalOp = { clientOpId: newClientOpId(), type, payload, state: 'pending', attempts: 0, createdAt: Date.now() };
  await tx('readwrite', s => s.put(op)); return op;
}
export async function pendingOps(): Promise<LocalOp[]> { const all = await tx<LocalOp[]>('readonly', s => s.getAll()); return all.filter(o => ['pending','rejected','conflict'].includes(o.state)); }
export async function countByState(): Promise<Record<string, number>> { const all = await tx<LocalOp[]>('readonly', s => s.getAll()); return all.reduce((a, o) => ({ ...a, [o.state]: (a[o.state as keyof typeof a] as number ?? 0) + 1 }), {} as Record<string, number>); }
/** Push with exponential backoff + jitter handled by caller scheduling; returns per-op acks. */
export async function syncNow(apiBase = ''): Promise<{ clientOpId: string; status: string; error?: string }[]> {
  const ops = await pendingOps(); const results: { clientOpId: string; status: string; error?: string }[] = [];
  if (!ops.length) return results;
  for (const op of ops) await tx('readwrite', s => s.put({ ...op, state: 'syncing', attempts: op.attempts + 1 }));
  try {
    const r = await fetch(`${apiBase}/api/v1/representatives/sync/push`, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ ops: ops.map(o => ({ clientOpId: o.clientOpId, type: o.type, payload: o.payload })) }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const acks = await r.json() as { clientOpId: string; status: string; error?: string }[];
    for (const ack of acks) { const op = ops.find(o => o.clientOpId === ack.clientOpId); if (op) await tx('readwrite', s => s.put({ ...op, state: ack.status === 'applied' ? 'synced' : ack.status, lastError: ack.error })); results.push(ack); }
  } catch (e) {
    for (const op of ops) await tx('readwrite', s => s.put({ ...op, state: 'pending', lastError: String(e) }));
    throw e;
  }
  return results;
}
export const backoffMs = (attempt: number) => Math.min(15 * 60_000, 5_000 * 2 ** attempt) + Math.floor(Math.random() * 1000);
