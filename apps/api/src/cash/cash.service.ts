import { Injectable } from '@nestjs/common';
import { DomainError, money, qMoney } from '@erpcloud/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';

@Injectable()
export class CashService {
  constructor(private prisma: PrismaService, private acc: AccountingService) {}
  /** Approved expense: Dr expense account (purpose EXPENSE_<CATEGORY> else EXPENSE_GENERAL), Cr the cash/bank account's GL account. */
  async postExpense(tenantId: string, input: { category: string; description?: string; amount: string; cashAccountId: string; businessDate: string; idempotencyKey: string; createdBy?: string }) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const ca = await tx.cashAccount.findUnique({ where: { id: input.cashAccountId } });
      if (!ca || ca.tenantId !== tenantId) throw new DomainError('NOT_FOUND', 'حساب النقد/البنك غير موجود');
      let expAcc: string;
      try { expAcc = await this.acc.resolveAccount(tx, tenantId, `EXPENSE_${input.category.toUpperCase()}`); }
      catch { expAcc = await this.acc.resolveAccount(tx, tenantId, 'EXPENSE_GENERAL'); }
      const entry = await this.acc.postJournalTx(tx, tenantId, { businessDate: input.businessDate, description: input.description ?? `مصروف ${input.category}`, lines: [ { accountId: expAcc, debit: input.amount, credit: '0' }, { accountId: ca.accountId, debit: '0', credit: input.amount } ], sourceType: 'expense', sourceId: input.idempotencyKey, idempotencyKey: `${input.idempotencyKey}:journal`, createdBy: input.createdBy });
      return tx.expense.create({ data: { tenantId, category: input.category, description: input.description ?? null, amount: money(input.amount) as never, cashAccountId: input.cashAccountId, businessDate: new Date(input.businessDate), status: 'posted', journalEntryId: entry.id, createdBy: input.createdBy ?? null } });
    });
  }
  /** Customer receipt / supplier payment with allocation; unallocated remainder stays as advance (party balance reflects it). */
  async postPayment(tenantId: string, input: { partyId: string; direction: 'in' | 'out'; method: string; amount: string; cashAccountId: string; businessDate: string; idempotencyKey: string; allocateTo?: { documentType: string; documentId: string; amount: string }; createdBy?: string }) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const dup = await tx.payment.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } } });
      if (dup) return dup;
      const ca = await tx.cashAccount.findUnique({ where: { id: input.cashAccountId } });
      if (!ca) throw new DomainError('NOT_FOUND', 'حساب النقد/البنك غير موجود');
      const control = await this.acc.resolveAccount(tx, tenantId, input.direction === 'in' ? 'AR_CUSTOMER' : 'AP_SUPPLIER');
      const amt = qMoney(money(input.amount)).toString();
      const lines = input.direction === 'in'
        ? [ { accountId: ca.accountId, debit: amt, credit: '0' }, { accountId: control, debit: '0', credit: amt, partyId: input.partyId } ]
        : [ { accountId: control, debit: amt, credit: '0', partyId: input.partyId }, { accountId: ca.accountId, debit: '0', credit: amt } ];
      const entry = await this.acc.postJournalTx(tx, tenantId, { businessDate: input.businessDate, description: input.direction === 'in' ? 'سند قبض' : 'سند دفع', lines, sourceType: 'payment', sourceId: input.idempotencyKey, idempotencyKey: `${input.idempotencyKey}:journal`, createdBy: input.createdBy });
      const pay = await tx.payment.create({ data: { tenantId, partyId: input.partyId, direction: input.direction, method: input.method, amount: money(input.amount) as never, businessDate: new Date(input.businessDate), settlementStatus: input.method === 'electronic' ? 'pending' : 'settled', journalEntryId: entry.id, idempotencyKey: input.idempotencyKey, createdBy: input.createdBy ?? null } });
      if (input.allocateTo) {
        if (money(input.allocateTo.amount).gt(money(input.amount))) throw new DomainError('OVER_ALLOCATION', 'التخصيص أكبر من قيمة السند');
        await tx.paymentAllocation.create({ data: { tenantId, paymentId: pay.id, documentType: input.allocateTo.documentType, documentId: input.allocateTo.documentId, amount: money(input.allocateTo.amount) as never } });
        if (input.allocateTo.documentType === 'sales_invoice') {
          const inv = await tx.salesInvoice.findUnique({ where: { id: input.allocateTo.documentId } });
          const newPaid = money(inv.paidAmount.toString()).plus(money(input.allocateTo.amount));
          await tx.salesInvoice.update({ where: { id: inv.id }, data: { paidAmount: qMoney(newPaid) as never, paymentStatus: newPaid.gte(money(inv.total.toString())) ? 'paid' : 'partially_paid' } });
        }
      }
      return pay;
    });
  }
}
