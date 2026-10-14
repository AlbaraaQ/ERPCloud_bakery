import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';

export interface SyncOp { clientOpId: string; type: string; payload: any; }
export const payloadHash = (payload: unknown) => createHash('sha256').update(JSON.stringify(payload, Object.keys(payload as object).sort())).digest('hex');
// Stable hash: sort keys recursively
export function stableHash(payload: unknown): string {
  const canon = (v: any): any => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canon(payload))).digest('hex');
}

@Injectable()
export class SyncService {
  constructor(private prisma: PrismaService, private sales: SalesService) {}

  /** Push batch: per-op result. Duplicate clientOpId+same hash returns the original result; different hash = conflict (never applied). */
  async push(tenantId: string, ctx: { userId: string; deviceId?: string; allowPriceOverride?: boolean }, ops: SyncOp[]) {
    const results: any[] = [];
    for (const op of ops) {
      const hash = stableHash(op.payload);
      const existing = await this.prisma.withTenant(tenantId, (tx: any) => tx.syncOperation.findUnique({ where: { tenantId_userId_clientOpId: { tenantId, userId: ctx.userId, clientOpId: op.clientOpId } } }));
      if (existing) {
        results.push(existing.payloadHash !== hash
          ? { clientOpId: op.clientOpId, status: 'conflict', error: 'تم تغيير حمولة عملية مُستلمة مسبقاً — لن يتم تطبيقها' }
          : { clientOpId: op.clientOpId, status: existing.status, resultDocumentId: existing.resultDocumentId, duplicate: true });
        continue;
      }
      try {
        if (op.type !== 'sales_invoice') throw new Error(`نوع عملية غير مدعوم: ${op.type}`);
        const doc = await this.sales.createInvoice(tenantId, { ...op.payload, idempotencyKey: op.clientOpId }, { post: true, createdBy: ctx.userId, allowPriceOverride: ctx.allowPriceOverride });
        await this.prisma.withTenant(tenantId, (tx: any) => tx.syncOperation.create({ data: { tenantId, userId: ctx.userId, deviceId: ctx.deviceId ?? null, clientOpId: op.clientOpId, type: op.type, payload: op.payload, payloadHash: hash, status: 'applied', resultDocumentId: doc.id } }));
        results.push({ clientOpId: op.clientOpId, status: 'applied', resultDocumentId: doc.id });
      } catch (e: any) {
        const msg = (e?.message ?? 'خطأ غير معروف').slice(0, 500);
        await this.prisma.withTenant(tenantId, (tx: any) => tx.syncOperation.create({ data: { tenantId, userId: ctx.userId, deviceId: ctx.deviceId ?? null, clientOpId: op.clientOpId, type: op.type, payload: op.payload, payloadHash: hash, status: 'rejected', error: msg } }));
        results.push({ clientOpId: op.clientOpId, status: 'rejected', error: msg });
      }
    }
    return results;
  }

  async pull(tenantId: string, warehouseId: string) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const [products, parties, balances] = await Promise.all([
        tx.product.findMany({ where: { tenantId, isActive: true }, take: 1000 }),
        tx.party.findMany({ where: { tenantId, isActive: true, kind: { in: ['customer', 'both'] } }, take: 1000 }),
        tx.stockBalance.findMany({ where: { tenantId, warehouseId } }),
      ]);
      return { products, parties, balances, serverTime: new Date().toISOString() };
    });
  }
}
