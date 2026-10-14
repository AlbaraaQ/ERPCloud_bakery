import { Injectable } from '@nestjs/common';
import { DomainError, money, qMoney } from '@erpcloud/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { InventoryService } from '../inventory/inventory.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class SettlementsService {
  constructor(private prisma: PrismaService, private acc: AccountingService, private inv: InventoryService, private notif: NotificationsService) {}

  async request(tenantId: string, input: { employeeId: string; periodStart: string; periodEnd: string; createdBy?: string }) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const profile = await tx.representativeProfile.findUnique({ where: { employeeId: input.employeeId } });
      if (!profile?.isActive) throw new DomainError('NOT_FOUND', 'ملف المندوب غير موجود أو غير مفعّل');
      const open = await tx.settlement.findFirst({ where: { tenantId, employeeId: input.employeeId, status: { in: ['requested', 'under_review'] } } });
      if (open) return open; // one open settlement per rep
      // expected cash = cash payments allocated to this rep's invoices + cash receipts created by rep user, in period
      const repInvoices = await tx.salesInvoice.findMany({ where: { tenantId, representativeId: input.employeeId, businessDate: { gte: new Date(input.periodStart), lte: new Date(input.periodEnd) }, accountingStatus: 'posted' }, select: { id: true } });
      const ids = repInvoices.map((i: any) => i.id);
      let expectedCash = money(0);
      if (ids.length) {
        const allocs = await tx.paymentAllocation.findMany({ where: { tenantId, documentType: 'sales_invoice', documentId: { in: ids } }, include: { payment: true } });
        for (const a of allocs) if (a.payment.method === 'cash' && a.payment.direction === 'in') expectedCash = expectedCash.plus(money(a.payment.amount.toString()));
      }
      const s = await tx.settlement.create({ data: { tenantId, employeeId: input.employeeId, warehouseId: profile.warehouseId, periodStart: new Date(input.periodStart), periodEnd: new Date(input.periodEnd), expectedCash: qMoney(expectedCash) as never, createdBy: input.createdBy ?? null } });
      const balances = await tx.stockBalance.findMany({ where: { tenantId, warehouseId: profile.warehouseId } });
      for (const b of balances) await tx.settlementLine.create({ data: { tenantId, settlementId: s.id, productId: b.productId, expectedQty: b.qty } });
      await this.notif.notifyPermissionHolders(tx, tenantId, 'settlement.view', { type: 'settlement.requested', title: 'طلب تسوية جديد من مندوب', refType: 'settlement', refId: s.id });
      if (profile.userId) await this.notif.notify(tx, tenantId, { userId: profile.userId, type: 'settlement.requested', title: 'تم إنشاء طلب التسوية', refType: 'settlement', refId: s.id });
      return s;
    });
  }

  /** Finalize with row lock. Discrepancies become exceptions and BLOCK finalization until decided. Shortage never auto-creates employee debt. */
  async finalize(tenantId: string, input: { settlementId: string; counted: { productId: string; qty: string }[]; countedCash: string; cashHandedOver: string; businessDate: string; finalizedBy?: string }) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const rows = await tx.$queryRaw`SELECT * FROM settlements WHERE id = ${input.settlementId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
      const s = rows[0];
      if (!s) throw new DomainError('NOT_FOUND', 'التسوية غير موجودة');
      if (s.status === 'finalized') throw new DomainError('ALREADY_FINALIZED', 'هذه التسوية مُغلقة مسبقاً');
      const lines = await tx.settlementLine.findMany({ where: { settlementId: s.id } });
      let blocked = false;
      for (const l of lines) {
        const c = input.counted.find(x => x.productId === l.productId);
        const countedQty = c ? money(c.qty) : money(0);
        await tx.settlementLine.update({ where: { id: l.id }, data: { countedQty: countedQty as never } });
        const diff = countedQty.minus(money(l.expectedQty.toString()));
        if (!diff.isZero()) {
          const approved = await tx.settlementException.findFirst({ where: { settlementId: s.id, productId: l.productId, status: { in: ['approved_adjustment', 'approved_employee_receivable'] } } });
          const covered = approved && money(approved.qty?.toString() ?? '0').equals(diff.abs());
          if (!covered) {
            blocked = true;
            const exists = await tx.settlementException.findFirst({ where: { settlementId: s.id, productId: l.productId, status: 'under_investigation' } });
            if (!exists) await tx.settlementException.create({ data: { tenantId, settlementId: s.id, kind: diff.lt(0) ? 'stock_shortage' : 'stock_surplus', productId: l.productId, qty: diff.abs() as never } });
          }
        }
      }
      const cashDiff = money(input.countedCash).minus(money(s.expected_cash));
      if (!cashDiff.isZero()) {
        const approvedCash = await tx.settlementException.findFirst({ where: { settlementId: s.id, kind: { in: ['cash_shortage', 'cash_surplus'] }, status: { in: ['approved_adjustment', 'approved_employee_receivable'] } } });
        const covered = approvedCash && money(approvedCash.amount?.toString() ?? '0').equals(cashDiff.abs());
        if (!covered) {
          blocked = true;
          const exists = await tx.settlementException.findFirst({ where: { settlementId: s.id, kind: { in: ['cash_shortage', 'cash_surplus'] }, status: 'under_investigation' } });
          if (!exists) await tx.settlementException.create({ data: { tenantId, settlementId: s.id, kind: cashDiff.lt(0) ? 'cash_shortage' : 'cash_surplus', amount: qMoney(cashDiff.abs()) as never } });
        }
      }
      const openExceptions = await tx.settlementException.count({ where: { settlementId: s.id, status: 'under_investigation' } });
      if (blocked || openExceptions > 0) {
        await tx.settlement.update({ where: { id: s.id }, data: { status: 'under_review', countedCash: money(input.countedCash) as never, cashHandedOver: money(input.cashHandedOver) as never } });
        return { settlement: await tx.settlement.findUnique({ where: { id: s.id }, include: { lines: true, exceptions: true } }), finalized: false, reason: 'توجد فروقات قيد التحقق — لا يمكن الإغلاق قبل اعتماد قراراتها' };
      }
      const finalized = await tx.settlement.update({ where: { id: s.id }, data: { status: 'finalized', countedCash: money(input.countedCash) as never, cashHandedOver: money(input.cashHandedOver) as never, finalizedBy: input.finalizedBy ?? null, finalizedAt: new Date() } });
      const profile = await tx.representativeProfile.findUnique({ where: { employeeId: s.employee_id } });
      if (profile?.userId) await this.notif.notify(tx, tenantId, { userId: profile.userId, type: 'settlement.finalized', title: 'أُغلقت تسويتك بنجاح دون فروقات', refType: 'settlement', refId: s.id });
      return { settlement: finalized, finalized: true };
    });
  }

  /** Decide an exception. Default = inventory/cash adjustment. Employee receivable is an explicit, separate, approved decision — never automatic, never a payroll deduction. */
  async decideException(tenantId: string, input: { exceptionId: string; decision: 'adjustment' | 'employee_receivable' | 'rejected'; reason: string; businessDate: string; decidedBy?: string }) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const ex = await tx.settlementException.findUnique({ where: { id: input.exceptionId } });
      if (!ex || ex.status !== 'under_investigation') throw new DomainError('NO_OPEN_EXCEPTION', 'لا يوجد استثناء مفتوح');
      const s = await tx.settlement.findUnique({ where: { id: ex.settlementId } });
      let journalId: string | undefined;
      if (input.decision === 'adjustment' && ex.productId) {
        const shortage = ex.kind === 'stock_shortage';
        let surplusCost: string | undefined;
        if (!shortage) { const bal = await tx.stockBalance.findFirst({ where: { tenantId, productId: ex.productId, warehouseId: s.warehouseId } }); surplusCost = bal?.avgCost?.toString() ?? '0'; if (money(surplusCost ?? '0').lte(0)) throw new DomainError('COST_REQUIRED', 'لا توجد تكلفة معروفة للزيادة — أدخل تكلفة عبر حركة مخزون أولاً'); }
        const m = await this.inv.postMovementTx(tx, tenantId, { productId: ex.productId, warehouseId: s.warehouseId, type: 'settlement_adjustment', qty: (shortage ? money(ex.qty.toString()).neg() : money(ex.qty.toString())).toString(), unitCost: surplusCost, sourceType: 'settlement_exception', sourceId: ex.id, idempotencyKey: `exception:${ex.id}:stock`, businessDate: input.businessDate, createdBy: input.decidedBy });
        const invAcc = await this.acc.resolveAccount(tx, tenantId, 'INVENTORY');
        const adjAcc = await this.acc.resolveAccount(tx, tenantId, shortage ? 'SHORTAGE_LOSS' : 'SHORTAGE_GAIN');
        const amount = money((m as any).unitCost.toString()).times(money(ex.qty.toString()));
        if (amount.gt(0)) {
          const entry = await this.acc.postJournalTx(tx, tenantId, { businessDate: input.businessDate, description: 'تسوية عجز/زيادة معتمدة', lines: shortage ? [{ accountId: adjAcc, debit: amount.toString(), credit: '0' }, { accountId: invAcc, debit: '0', credit: amount.toString() }] : [{ accountId: invAcc, debit: amount.toString(), credit: '0' }, { accountId: adjAcc, debit: '0', credit: amount.toString() }], sourceType: 'settlement_exception', sourceId: ex.id, idempotencyKey: `exception:${ex.id}:journal`, createdBy: input.decidedBy });
          journalId = entry.id;
        }
      }
      if (input.decision === 'employee_receivable') {
        // Requires explicit approved decision + configured mapping; records a receivable, does NOT touch payroll.
        const recAcc = await this.acc.resolveAccount(tx, tenantId, 'EMPLOYEE_RECEIVABLE');
        const lossAcc = await this.acc.resolveAccount(tx, tenantId, 'SHORTAGE_LOSS');
        const amount = ex.amount ? money(ex.amount.toString()) : money(0);
        if (amount.lte(0)) throw new DomainError('AMOUNT_REQUIRED', 'قرار مدينة الموظف يتطلب مبلغاً موثقاً في الاستثناء');
        const entry = await this.acc.postJournalTx(tx, tenantId, { businessDate: input.businessDate, description: 'مدينة موظف معتمدة بقرار موثق (ليست خصم راتب تلقائي)', lines: [{ accountId: recAcc, debit: amount.toString(), credit: '0' }, { accountId: lossAcc, debit: '0', credit: amount.toString() }], sourceType: 'settlement_exception', sourceId: ex.id, idempotencyKey: `exception:${ex.id}:receivable`, createdBy: input.decidedBy });
        journalId = entry.id;
      }
      return tx.settlementException.update({ where: { id: ex.id }, data: { status: input.decision === 'adjustment' ? 'approved_adjustment' : input.decision === 'employee_receivable' ? 'approved_employee_receivable' : 'rejected', decisionBy: input.decidedBy ?? null, decisionReason: input.reason, adjustmentJournalId: journalId ?? null } });
    });
  }
}
