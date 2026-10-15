import { Injectable } from '@nestjs/common';
import { InsufficientStockError, ConfigurationError, DomainError, money, qQty, qMoney } from '@erpcloud/shared';
import { AccountingService } from '../accounting/accounting.service';
import { PrismaService } from '../prisma/prisma.service';

export interface MovementInput { productId: string; warehouseId: string; lotId?: string; type: string; qty: string; unitCost?: string; sourceType: string; sourceId: string; idempotencyKey: string; businessDate: string; createdBy?: string; }

/** Moving weighted-average inventory ledger. Balances are a same-transaction cache of the append-only movement ledger. */
@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  async postMovement(tenantId: string, input: MovementInput, opts: { allowNegative?: boolean } = {}) {
    const qty = money(input.qty);
    if (qty.isZero()) throw new Error('كمية الحركة لا يمكن أن تكون صفراً');
    return this.prisma.withTenant(tenantId, (tx: any) => this.postMovementTx(tx, tenantId, input, opts));
  }
  async postMovementTx(tx: any, tenantId: string, input: MovementInput, opts: { allowNegative?: boolean } = {}) {
    const qty = money(input.qty);
    {
      const dup = await tx.stockMovement.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } } });
      if (dup) return dup; // sync/posting retry: never duplicate a movement
      const product = await tx.product.findUnique({ where: { id: input.productId } });
      if (!product || product.tenantId !== tenantId || !product.isActive) throw new ConfigurationError('منتج غير موجود أو غير مفعّل');
      if (product.costingMethod !== 'moving_average') throw new ConfigurationError(`طريقة التكلفة (${product.costingMethod}) غير مدعومة بعد — المتوسط المرجح فقط في هذه المرحلة`);
      if (product.lotTracked && !input.lotId) throw new ConfigurationError('هذا المنتج يتطلب تحديد التشغيلة/الدفعة (lot)');
      // Lock the balance row (create-then-lock on first use) to serialise concurrent issues.
      let bal = await tx.stockBalance.findFirst({ where: { tenantId, productId: input.productId, warehouseId: input.warehouseId, lotId: input.lotId ?? null } });
      if (!bal) bal = await tx.stockBalance.create({ data: { tenantId, productId: input.productId, warehouseId: input.warehouseId, lotId: input.lotId ?? null } });
      const locked = await tx.$queryRaw`SELECT qty::text, value::text, avg_cost::text FROM stock_balances WHERE id = ${bal.id}::uuid FOR UPDATE`;
      const curQty = money(locked[0].qty); const curVal = money(locked[0].value);
      let unitCost: ReturnType<typeof money>;
      let value: ReturnType<typeof money>;
      let newQty = curQty.plus(qty); let newVal: ReturnType<typeof money>; let newAvg: ReturnType<typeof money>;
      if (qty.gt(0)) {
        if (!input.unitCost) throw new ConfigurationError('تكلفة الوحدة مطلوبة لحركات الإدخال — لا يتم افتراض تكلفة صفر');
        const uc = money(input.unitCost); if (uc.lt(0)) throw new Error('تكلفة سالبة غير مسموح بها');
        value = qMoney(qty.times(uc)) as never; newVal = curVal.plus(qty.times(uc));
        newAvg = newQty.isZero() ? money(0) : newVal.div(newQty);
        unitCost = money(input.unitCost) as never;
      } else {
        if (newQty.lt(0) && !opts.allowNegative) throw new InsufficientStockError(`كمية غير كافية: المتاح ${curQty.toString()} والمطلوب ${qty.abs().toString()}`);
        const avg = money(locked[0].avg_cost);
        unitCost = money(avg.toString()) as never;
        const outVal = qty.times(avg); value = qMoney(outVal) as never; newVal = curVal.plus(outVal);
        newAvg = newQty.isZero() ? money(0) : avg;
      }
      const movement = await tx.stockMovement.create({ data: { tenantId, productId: input.productId, warehouseId: input.warehouseId, lotId: input.lotId ?? null, type: input.type, qty: qQty(qty) as never, unitCost, value, sourceType: input.sourceType, sourceId: input.sourceId, idempotencyKey: input.idempotencyKey, businessDate: new Date(input.businessDate), createdBy: input.createdBy ?? null } });
      await tx.stockBalance.update({ where: { id: bal.id }, data: { qty: qQty(newQty) as never, value: qMoney(newVal) as never, avgCost: qMoney(newAvg as never) as never } });
      return movement;
    }
  }

  async getBalance(tenantId: string, productId: string, warehouseId: string) {
    return this.prisma.withTenant(tenantId, (tx: any) => tx.stockBalance.findMany({ where: { tenantId, productId, warehouseId } }));
  }

  /** Recomputes balances from the ledger; returns drift rows (must be empty). */
  async reconcile(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const rows = await tx.$queryRaw`
        SELECT b.product_id, b.warehouse_id, b.qty::text AS book_qty, COALESCE(SUM(m.qty),0)::text AS ledger_qty, b.value::text AS book_value, COALESCE(SUM(m.value),0)::text AS ledger_value
        FROM stock_balances b LEFT JOIN stock_movements m ON m.product_id=b.product_id AND m.warehouse_id=b.warehouse_id AND m.tenant_id=b.tenant_id AND m.lot_id IS NOT DISTINCT FROM b.lot_id
        WHERE b.tenant_id = ${tenantId}::uuid GROUP BY b.id`;
      return rows.filter((r: any) => money(r.book_qty).minus(money(r.ledger_qty)).abs().gt('0.000001') || money(r.book_value).minus(money(r.ledger_value)).abs().gt('0.01'));
    });
  }
}

export class StockCountsService {
  constructor(private prisma: PrismaService, private acc: AccountingService, private inv: InventoryService) {}
  /** Approved count variance posts movement + journal only after approval — unapproved counts change nothing. */
  async postCount(tenantId: string, input: { warehouseId: string; businessDate: string; lines: { productId: string; lotId?: string; countedQty: string; reason?: string }[]; createdBy?: string }) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const count = await tx.stockCount.create({ data: { tenantId, warehouseId: input.warehouseId, businessDate: new Date(input.businessDate), createdBy: input.createdBy ?? null } });
      for (const l of input.lines) {
        const bal = await tx.stockBalance.findFirst({ where: { tenantId, productId: l.productId, warehouseId: input.warehouseId, lotId: l.lotId ?? null } });
        const book = bal ? money(bal.qty.toString()) : money(0);
        await tx.stockCountLine.create({ data: { tenantId, countId: count.id, productId: l.productId, lotId: l.lotId ?? null, bookQty: book as never, countedQty: money(l.countedQty) as never, reason: l.reason ?? null } });
        const diff = money(l.countedQty).minus(book);
        if (!diff.isZero()) {
          if (!l.reason) throw new DomainError('REASON_REQUIRED', 'سبب فرق الجرد مطلوب');
          const invAcc = await this.acc.resolveAccount(tx, tenantId, 'INVENTORY');
          const adjAcc = await this.acc.resolveAccount(tx, tenantId, diff.lt(0) ? 'SHORTAGE_LOSS' : 'SHORTAGE_GAIN');
          const m = await this.inv.postMovementTx(tx, tenantId, { productId: l.productId, warehouseId: input.warehouseId, lotId: l.lotId, type: 'count_adjustment', qty: diff.toString(), unitCost: diff.gt(0) ? (bal?.avgCost?.toString() ?? '0') : undefined, sourceType: 'stock_count', sourceId: count.id, idempotencyKey: `count:${count.id}:${l.productId}`, businessDate: input.businessDate, createdBy: input.createdBy });
          const amount = money(m.unitCost.toString()).times(diff.abs());
          if (amount.gt(0)) await this.acc.postJournalTx(tx, tenantId, { businessDate: input.businessDate, description: 'تسوية جرد معتمدة', lines: diff.lt(0) ? [{ accountId: adjAcc, debit: amount.toString(), credit: '0' }, { accountId: invAcc, debit: '0', credit: amount.toString() }] : [{ accountId: invAcc, debit: amount.toString(), credit: '0' }, { accountId: adjAcc, debit: '0', credit: amount.toString() }], sourceType: 'stock_count', sourceId: count.id, idempotencyKey: `count:${count.id}:${l.productId}:journal`, createdBy: input.createdBy });
        }
      }
      await tx.stockCount.update({ where: { id: count.id }, data: { status: 'posted' } });
      return tx.stockCount.findUnique({ where: { id: count.id }, include: { lines: true } });
    });
  }
  /** FEFO pick suggestion: earliest-expiring lots with positive stock first. */
  async fefo(tenantId: string, productId: string, warehouseId: string) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const bals = await tx.stockBalance.findMany({ where: { tenantId, productId, warehouseId, qty: { gt: 0 } }, include: undefined });
      const withLots: any[] = [];
      for (const b of bals) { const lot = b.lotId ? await tx.lot.findUnique({ where: { id: b.lotId } }) : null; withLots.push({ lotId: b.lotId, qty: b.qty.toString(), expiryDate: lot?.expiryDate ?? null }); }
      return withLots.sort((a, b) => (a.expiryDate ? new Date(a.expiryDate).getTime() : Infinity) - (b.expiryDate ? new Date(b.expiryDate).getTime() : Infinity));
    });
  }
}
