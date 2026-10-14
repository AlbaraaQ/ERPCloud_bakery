import { Injectable } from '@nestjs/common';
import { ConfigurationError, DomainError, money, qMoney } from '@erpcloud/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { InventoryService } from '../inventory/inventory.service';

const COMPONENT_PURPOSE: Record<string, string> = { labour: 'PRODUCTION_LABOUR', overhead: 'PRODUCTION_OVERHEAD', other: 'PRODUCTION_OTHER' };

@Injectable()
export class ManufacturingService {
  constructor(private prisma: PrismaService, private acc: AccountingService, private inv: InventoryService) {}

  async createBom(tenantId: string, input: { productId: string; name: string; lines: { ingredientProductId: string; qtyPerUnit: string; wastePercent?: string }[] }) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const bom = await tx.bom.create({ data: { tenantId, productId: input.productId, name: input.name } });
      for (const l of input.lines) await tx.bomLine.create({ data: { tenantId, bomId: bom.id, ingredientProductId: l.ingredientProductId, qtyPerUnit: money(l.qtyPerUnit) as never, wastePercent: money(l.wastePercent ?? '0') as never } });
      return tx.bom.findUnique({ where: { id: bom.id }, include: { lines: true } });
    });
  }

  async createOrder(tenantId: string, input: { bomId: string; warehouseId: string; plannedQty: string; businessDate: string; idempotencyKey: string; createdBy?: string }) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const bom = await tx.bom.findUnique({ where: { id: input.bomId } });
      if (!bom || bom.tenantId !== tenantId || !bom.isActive) throw new ConfigurationError('وصفة إنتاج (BOM) غير موجودة أو غير مفعّلة');
      const number = await this.acc.nextNumber(tx, tenantId, 'production_order');
      return tx.productionOrder.create({ data: { tenantId, number, bomId: bom.id, productId: bom.productId, warehouseId: input.warehouseId, plannedQty: money(input.plannedQty) as never, businessDate: new Date(input.businessDate), idempotencyKey: input.idempotencyKey, createdBy: input.createdBy ?? null } });
    });
  }

  /**
   * Completes production atomically: raw issues at moving-average cost, cost components,
   * finished receipt at (total - abnormal scrap cost)/good qty. Normal waste is absorbed in
   * good qty cost (it is inside consumption); abnormal scrap is expensed, never inflating
   * finished cost and never silently zero. Missing mapping/input blocks completion.
   */
  async complete(tenantId: string, input: { orderId: string; businessDate: string; goodQty: string; abnormalScrapQty?: string; scrapReason?: string; finishedLotCode?: string; finishedExpiry?: string; consumption: { productId: string; actualQty: string; lotId?: string }[]; components?: { kind: string; amount: string }[]; createdBy?: string }) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const rows = await tx.$queryRaw`SELECT * FROM production_orders WHERE id = ${input.orderId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
      const order = rows[0];
      if (!order) throw new DomainError('NOT_FOUND', 'أمر الإنتاج غير موجود');
      if (order.status === 'completed') return tx.productionOrder.findUnique({ where: { id: order.id }, include: { consumption: true, components: true } }); // idempotent
      const good = money(input.goodQty); const scrapQty = money(input.abnormalScrapQty ?? '0');
      if (good.lte(0)) throw new ConfigurationError('كمية الإنتاج الصالحة يجب أن تكون أكبر من صفر — لا يتم افتراض تكلفة صفر');
      const bomLines = await tx.bomLine.findMany({ where: { bomId: order.bom_id } });
      if (!bomLines.length) throw new ConfigurationError('وصفة الإنتاج بلا مكونات');
      // validate component mappings BEFORE posting anything
      const components = input.components ?? [];
      for (const c of components) {
        const purpose = COMPONENT_PURPOSE[c.kind]; if (!purpose) throw new ConfigurationError(`نوع مكون تكلفة غير معروف: ${c.kind}`);
        await this.acc.resolveAccount(tx, tenantId, purpose);
      }
      await this.acc.resolveAccount(tx, tenantId, 'INVENTORY');
      if (scrapQty.gt(0)) await this.acc.resolveAccount(tx, tenantId, 'SCRAP_LOSS');
      // finished lot
      let finishedLot: any = null;
      const finishedProduct = await tx.product.findUnique({ where: { id: order.product_id } });
      if (finishedProduct.lotTracked || input.finishedLotCode) {
        if (!input.finishedLotCode) throw new ConfigurationError('رقم تشغيلة المنتج التام مطلوب');
        finishedLot = await tx.lot.upsert({ where: { tenantId_productId_code: { tenantId, productId: order.product_id, code: input.finishedLotCode } }, create: { tenantId, productId: order.product_id, code: input.finishedLotCode, expiryDate: input.finishedExpiry ? new Date(input.finishedExpiry) : null }, update: {} });
      }
      // raw issues
      let materialCost = money(0); const consumptionRows: any[] = [];
      for (const c of input.consumption) {
        const bl = bomLines.find((x: any) => x.ingredientProductId === c.productId);
        const planned = bl ? money(bl.qtyPerUnit.toString()).times(money(order.planned_qty)).times(money(1).plus(money(bl.wastePercent.toString()).div(100))) : money(0);
        const m = await this.inv.postMovementTx(tx, tenantId, { productId: c.productId, warehouseId: order.warehouse_id, lotId: c.lotId, type: 'production_issue', qty: money(c.actualQty).neg().toString(), sourceType: 'production_order', sourceId: order.id, idempotencyKey: `prod:${order.id}:issue:${c.productId}`, businessDate: input.businessDate, createdBy: input.createdBy });
        const cost = money(m.unitCost.toString()).times(money(c.actualQty));
        materialCost = materialCost.plus(cost);
        consumptionRows.push({ productId: c.productId, lotId: c.lotId ?? null, planned, actual: money(c.actualQty), unitCost: m.unitCost });
        if (finishedLot && c.lotId) await tx.lotGenealogy.create({ data: { tenantId, finishedLotId: finishedLot.id, rawLotId: c.lotId, rawProductId: c.productId, qty: money(c.actualQty) as never, orderId: order.id } });
      }
      const componentTotal = components.reduce((a, c) => a.plus(money(c.amount)), money(0));
      const totalCost = materialCost.plus(componentTotal);
      if (totalCost.lte(0)) throw new ConfigurationError('إجمالي تكلفة الإنتاج صفر — تحقق من تكاليف المواد والمكونات. لا يتم اعتماد تكلفة صفر');
      const producedQty = good.plus(scrapQty);
      const unitProduced = totalCost.div(producedQty);
      const scrapCost = unitProduced.times(scrapQty);
      const finishedValue = totalCost.minus(scrapCost);
      const finishedUnit = finishedValue.div(good);
      await this.inv.postMovementTx(tx, tenantId, { productId: order.product_id, warehouseId: order.warehouse_id, lotId: finishedLot?.id, type: 'production_receipt', qty: good.toString(), unitCost: qMoney(finishedUnit).toString(), sourceType: 'production_order', sourceId: order.id, idempotencyKey: `prod:${order.id}:receipt`, businessDate: input.businessDate, createdBy: input.createdBy });
      // journal
      const invAcc = await this.acc.resolveAccount(tx, tenantId, 'INVENTORY');
      const lines: any[] = [{ accountId: invAcc, debit: qMoney(finishedValue).toString(), credit: '0' }];
      if (scrapQty.gt(0)) { const scrapAcc = await this.acc.resolveAccount(tx, tenantId, 'SCRAP_LOSS'); lines.push({ accountId: scrapAcc, debit: qMoney(scrapCost).toString(), credit: '0' }); await tx.scrapRecord.create({ data: { tenantId, orderId: order.id, productId: order.product_id, qty: scrapQty as never, kind: 'abnormal', amount: qMoney(scrapCost) as never, reason: input.scrapReason ?? null } }); }
      lines.push({ accountId: invAcc, debit: '0', credit: qMoney(materialCost).toString() });
      for (const c of components) { const a = await this.acc.resolveAccount(tx, tenantId, COMPONENT_PURPOSE[c.kind]); lines.push({ accountId: a, debit: '0', credit: qMoney(money(c.amount)).toString() }); await tx.productionCostComponent.create({ data: { tenantId, orderId: order.id, kind: c.kind, amount: money(c.amount) as never } }); }
      const entry = await this.acc.postJournalTx(tx, tenantId, { businessDate: input.businessDate, description: 'إتمام أمر إنتاج', lines, sourceType: 'production_order', sourceId: order.id, idempotencyKey: `prod:${order.id}:journal`, createdBy: input.createdBy });
      for (const r of consumptionRows) await tx.productionConsumption.create({ data: { tenantId, orderId: order.id, productId: r.productId, lotId: r.lotId, plannedQty: r.planned as never, actualQty: r.actual as never, unitCost: r.unitCost } });
      await tx.productionOrder.update({ where: { id: order.id }, data: { status: 'completed', goodQty: good as never, abnormalScrapQty: scrapQty as never, finishedLotId: finishedLot?.id ?? null, totalCost: qMoney(totalCost) as never, unitCost: qMoney(finishedUnit) as never, journalEntryId: entry.id } });
      return tx.productionOrder.findUnique({ where: { id: order.id }, include: { consumption: true, components: true } });
    });
  }

  /** Traceability: finished lot -> raw lots; raw lot -> finished lots (recall both directions). */
  async trace(tenantId: string, input: { finishedLotId?: string; rawLotId?: string }) {
    return this.prisma.withTenant(tenantId, (tx: any) => tx.lotGenealogy.findMany({ where: { tenantId, ...(input.finishedLotId ? { finishedLotId: input.finishedLotId } : {}), ...(input.rawLotId ? { rawLotId: input.rawLotId } : {}) } }));
  }

  async variance(tenantId: string, orderId: string) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const rows = await tx.productionConsumption.findMany({ where: { tenantId, orderId } });
      return rows.map((r: any) => ({ productId: r.productId, planned: r.plannedQty.toString(), actual: r.actualQty.toString(), variance: money(r.actualQty.toString()).minus(money(r.plannedQty.toString())).toString(), unitCost: r.unitCost.toString() }));
    });
  }
}
