import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
/** Lazily loads generated Prisma client (generated in CI / DB-capable machines); dynamic import
 *  lets the foundation type-check/boot liveness where Prisma engine download is unavailable (B-003). */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private _client: any; private readonly log = new Logger('Prisma');
  get client(): any {
    if (!this._client) { const { PrismaClient } = require('@prisma/client'); this._client = new PrismaClient(); }
    return this._client;
  }
  async ping(): Promise<boolean> { try { await this.client.$queryRaw`SELECT 1`; return true; } catch { this.log.warn('DB ping failed'); return false; } }
  /** Runs fn in a transaction with RLS tenant context set (SET LOCAL via set_config(...,true)). */
  async withTenant(tenantId: string, fn: (tx: any) => Promise<any>): Promise<any> {
    return this.client.$transaction(async (tx: any) => { await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`; return fn(tx); });
  }
  /** Server-only pre-auth/platform context (login lookup, provisioning). Never settable from client input. */
  async withPlatform(fn: (tx: any) => Promise<any>): Promise<any> {
    return this.client.$transaction(async (tx: any) => { await tx.$executeRaw`SELECT set_config('app.platform_access', 'on', true)`; return fn(tx); });
  }
  async onModuleDestroy() { if (this._client) await this._client.$disconnect(); }
}
