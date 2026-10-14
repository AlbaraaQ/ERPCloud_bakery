import { AsyncLocalStorage } from 'node:async_hooks';
export interface TenantCtx { tenantId: string; userId: string; permissions: string[]; deviceId?: string; }
export const tenantStorage = new AsyncLocalStorage<TenantCtx>();
export function currentTenant(): TenantCtx {
  const c = tenantStorage.getStore();
  if (!c) throw new Error('Tenant context missing — request was not authenticated (fail closed)');
  return c;
}
