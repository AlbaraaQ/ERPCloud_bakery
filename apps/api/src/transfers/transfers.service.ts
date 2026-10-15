import { Injectable } from '@nestjs/common';
import { DomainError, money } from '@erpcloud/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { InventoryService } from '../inventory/inventory.service';
import { RepresentativesService } from '../representatives/representatives.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class TransfersService {
  constructor(private prisma: PrismaService, private acc: AccountingService, private inv: InventoryService, private reps: RepresentativesService, private notif: NotificationsService) {}

  async dispatch(tenantId: string, input: { fromWarehouseId: string; toWarehouseId: string; businessDate: string; idempotencyKey: string; lines: { productId: string; qty: string; lotId?: string }[]; dispatchedBy?: string }) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const dup = await tx.stockTransfer.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } }, include: { lines: true } });
      if (dup) return dup;
      const transit = await this.reps.transitWarehouse(tx, tenantId);
      const number = await this.acc.nextNumber(tx, tenantId, 'transfer');
      const tr = await tx.stockTransfer.create({ data: { tenantId, number, fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId, status: 'dispatched', businessDate: new Date(input.businessDate), dispatchedBy: input.dispatchedBy ?? null, idempotencyKey: input.idempotencyKey } });
      for (const l of input.lines) {
        await tx.transferLine.create({ data: { tenantId, transferId: tr.id, productId: l.productId, lotId: l.lotId ?? null, dispatchedQty: money(l.qty) as never } });
        await this.inv.postMovementTx(tx, tenantId, { productId: l.productId, warehouseId: input.fromWarehouseId, lotId: l.lotId, type: 'transfer_out', qty: money(l.qty).neg().toString(), sourceType: 'stock_transfer', sourceId: tr.id, idempotencyKey: `${input.idempotencyKey}:out:${l.productId}`, businessDate: input.businessDate, createdBy: input.dispatchedBy });
        // in-transit receipt needs unit cost: reuse source avg by moving at cost — movement in with cost from out movement
        const out = await tx.stockMovement.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: `${input.idempotencyKey}:out:${l.productId}` } } });
        await this.inv.postMovementTx(tx, tenantId, { productId: l.productId, warehouseId: transit.id, lotId: l.lotId, type: 'transfer_in_transit', qty: l.qty, unitCost: out.unitCost.toString(), sourceType: 'stock_transfer', sourceId: tr.id, idempotencyKey: `${input.idempotencyKey}:transit:${l.productId}`, businessDate: input.businessDate, createdBy: input.dispatchedBy });
      }
      const profile = await tx.representativeProfile.findUnique({ where: { warehouseId: input.toWarehouseId } });
      if (profile?.userId) await this.notif.notify(tx, tenantId, { userId: profile.userId, type: 'transfer.dispatched', title: 'تحويل مخزون جديد بانتظار الاستلام', refType: 'stock_transfer', refId: tr.id });
      return tx.stockTransfer.findUnique({ where: { id: tr.id }, include: { lines: true } });
    });
  }

  /** Accept (full/partial) or dispute quantities. Cumulative received+disputed can never exceed dispatched — a transfer cannot be received twice. */
  async receive(tenantId: string, input: { transferId: string; lines: { productId: string; acceptedQty: string; disputedQty?: string; disputeReason?: string }[]; receivedBy?: string; businessDate: string }) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const rows = await tx.$queryRaw`SELECT * FROM stock_transfers WHERE id = ${input.transferId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
      const tr = rows[0];
      if (!tr) throw new DomainError('NOT_FOUND', 'التحويل غير موجود');
      if (['closed', 'cancelled', 'received'].includes(tr.status)) throw new DomainError('ALREADY_RECEIVED', 'هذا التحويل مُستلم/مغلق مسبقاً');
      const transit = await this.reps.transitWarehouse(tx, tenantId);
      let anyDispute = false, allDone = true;
      for (const l of input.lines) {
        const line = await tx.transferLine.findFirst({ where: { transferId: tr.id, productId: l.productId } });
        if (!line) throw new DomainError('NOT_FOUND', 'سطر تحويل غير موجود');
        const newReceived = money(line.receivedQty.toString()).plus(money(l.acceptedQty));
        const newDisputed = money(line.disputedQty.toString()).plus(money(l.disputedQty ?? '0'));
        if (newReceived.plus(newDisputed).gt(money(line.dispatchedQty.toString()))) throw new DomainError('OVER_RECEIPT', 'الاستلام + المتنازع عليه أكبر من المُرسل — لا يمكن استلام التحويل مرتين');
        if (money(l.disputedQty ?? '0').gt(0)) { anyDispute = true; if (!l.disputeReason) throw new DomainError('DISPUTE_REASON_REQUIRED', 'سبب الاختلاف مطلوب'); }
        if (newReceived.plus(newDisputed).lt(money(line.dispatchedQty.toString()))) allDone = false;
        await tx.transferLine.update({ where: { id: line.id }, data: { receivedQty: newReceived as never, disputedQty: newDisputed as never, disputeReason: l.disputeReason ?? line.disputeReason } });
        if (money(l.acceptedQty).gt(0)) {
          const tm = await tx.stockMovement.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: `${tr.idempotency_key}:transit:${l.productId}` } } }).catch(() => null);
          await this.inv.postMovementTx(tx, tenantId, { productId: l.productId, warehouseId: transit.id, lotId: line.lotId, type: 'transfer_out_transit', qty: money(l.acceptedQty).neg().toString(), sourceType: 'stock_transfer', sourceId: tr.id, idempotencyKey: `${tr.idempotency_key}:tout:${l.productId}:${newReceived.toString()}`, businessDate: input.businessDate, createdBy: input.receivedBy });
          await this.inv.postMovementTx(tx, tenantId, { productId: l.productId, warehouseId: tr.to_warehouse_id, lotId: line.lotId, type: 'transfer_in', qty: l.acceptedQty, unitCost: (() => { if (!tm) throw new DomainError('COST_REQUIRED', 'حركة الطريق غير موجودة لهذا التحويل'); return tm.unitCost.toString(); })(), sourceType: 'stock_transfer', sourceId: tr.id, idempotencyKey: `${tr.idempotency_key}:tin:${l.productId}:${newReceived.toString()}`, businessDate: input.businessDate, createdBy: input.receivedBy });
        }
      }
      const status = anyDispute ? 'disputed' : allDone ? 'received' : 'partially_received';
      await tx.stockTransfer.update({ where: { id: tr.id }, data: { status, receivedBy: input.receivedBy ?? null } });
      if (anyDispute) await this.notif.notifyPermissionHolders(tx, tenantId, 'inventory.transfer.dispatch', { type: 'transfer.dispute', title: 'اختلاف في استلام تحويل مخزون يحتاج مراجعة المحاسبة', refType: 'stock_transfer', refId: tr.id });
      return tx.stockTransfer.findUnique({ where: { id: tr.id }, include: { lines: true } });
    });
  }

  /** Accountant resolution of disputed qty: return to source, or approve shortage (loss out of transit, journal via Phase2 mapping SHORTAGE_LOSS/INVENTORY when configured). */
  async resolveDispute(tenantId: string, input: { transferId: string; productId: string; action: 'return_to_source' | 'approve_shortage'; businessDate: string; resolvedBy?: string }) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const tr = await tx.stockTransfer.findUnique({ where: { id: input.transferId } });
      const line = await tx.transferLine.findFirst({ where: { transferId: input.transferId, productId: input.productId } });
      if (!tr || !line || money(line.disputedQty.toString()).lte(0)) throw new DomainError('NO_DISPUTE', 'لا يوجد كمية متنازع عليها');
      const transit = await this.reps.transitWarehouse(tx, tenantId);
      const qty = line.disputedQty.toString();
      const tm = await tx.stockMovement.findFirst({ where: { tenantId, sourceType: 'stock_transfer', sourceId: tr.id }, orderBy: { createdAt: 'asc' } });
      if (input.action === 'return_to_source') {
        await this.inv.postMovementTx(tx, tenantId, { productId: input.productId, warehouseId: transit.id, type: 'transfer_out_transit', qty: money(qty).neg().toString(), sourceType: 'stock_transfer', sourceId: tr.id, idempotencyKey: `${tr.idempotencyKey}:ret-out:${input.productId}`, businessDate: input.businessDate });
        await this.inv.postMovementTx(tx, tenantId, { productId: input.productId, warehouseId: tr.fromWarehouseId, type: 'transfer_return', qty, unitCost: tm?.unitCost?.toString() ?? '0', sourceType: 'stock_transfer', sourceId: tr.id, idempotencyKey: `${tr.idempotencyKey}:ret-in:${input.productId}`, businessDate: input.businessDate });
      } else {
        const m = await this.inv.postMovementTx(tx, tenantId, { productId: input.productId, warehouseId: transit.id, type: 'transfer_shortage', qty: money(qty).neg().toString(), sourceType: 'stock_transfer', sourceId: tr.id, idempotencyKey: `${tr.idempotencyKey}:short:${input.productId}`, businessDate: input.businessDate });
        const lossAcc = await this.acc.resolveAccount(tx, tenantId, 'SHORTAGE_LOSS');
        const invAcc = await this.acc.resolveAccount(tx, tenantId, 'INVENTORY');
        const amount = money(m.unitCost.toString()).times(money(qty));
        if (amount.gt(0)) await this.acc.postJournalTx(tx, tenantId, { businessDate: input.businessDate, description: 'عجز تحويل معتمد', lines: [{ accountId: lossAcc, debit: amount.toString(), credit: '0' }, { accountId: invAcc, debit: '0', credit: amount.toString() }], sourceType: 'stock_transfer', sourceId: tr.id, idempotencyKey: `${tr.idempotencyKey}:short-journal`, createdBy: input.resolvedBy });
      }
      await tx.transferLine.update({ where: { id: line.id }, data: { resolvedQty: money(line.receivedQty.toString()).isZero() ? (money(line.resolvedQty?.toString() ?? '0').plus(money(line.disputedQty.toString())) as never) : (money(line.resolvedQty?.toString() ?? '0').plus(money(line.disputedQty.toString())) as never), disputedQty: 0 as never, disputeReason: null } });
      const lines = await tx.transferLine.findMany({ where: { transferId: tr.id } });
      const done = lines.every((x: any) => money(x.receivedQty.toString()).plus(money(x.resolvedQty?.toString() ?? '0')).gte(money(x.dispatchedQty.toString()))) && lines.every((x: any) => money(x.disputedQty.toString()).isZero());
      await tx.stockTransfer.update({ where: { id: tr.id }, data: { status: done ? 'closed' : tr.status } });
      return tx.stockTransfer.findUnique({ where: { id: tr.id }, include: { lines: true } });
    });
  }
}
