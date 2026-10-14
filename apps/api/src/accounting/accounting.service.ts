import { Injectable } from '@nestjs/common';
import { ConfigurationError, PeriodClosedError, ConflictError, assertBalanced, money } from '@erpcloud/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface JournalLineInput { accountId: string; debit: string; credit: string; branchId?: string; warehouseId?: string; representativeId?: string; costCenter?: string; partyId?: string; }
export function validateLines(lines: JournalLineInput[]) {
  if (lines.length < 2) throw new Error('Journal needs at least 2 lines / يحتاج القيد إلى سطرين على الأقل');
  for (const l of lines) {
    const d = money(l.debit), c = money(l.credit);
    if (d.lt(0) || c.lt(0)) throw new Error('Negative debit/credit not allowed');
    if (d.gt(0) === c.gt(0)) throw new Error('Each line must have exactly one of debit/credit / كل سطر إما مدين أو دائن');
  }
  assertBalanced(lines.map(l => ({ debit: money(l.debit), credit: money(l.credit) })));
}

@Injectable()
export class AccountingService {
  constructor(private prisma: PrismaService) {}

  async resolveAccount(tx: any, tenantId: string, purpose: string): Promise<string> {
    const m = await tx.accountMapping.findUnique({ where: { tenantId_purpose: { tenantId, purpose } } });
    if (!m) throw new ConfigurationError(`حساب غير مُكوَّن للغرض (${purpose}) — يرجى تكوين الربط المحاسبي أولاً. Missing account mapping for purpose: ${purpose}`);
    return m.accountId as string;
  }

  async assertPeriodOpen(tx: any, tenantId: string, businessDate: Date) {
    const p = await tx.accountingPeriod.findFirst({ where: { tenantId, startDate: { lte: businessDate }, endDate: { gte: businessDate } } });
    if (!p) throw new ConfigurationError('لا توجد فترة محاسبية تغطي هذا التاريخ — أنشئ السنة المالية وفتراتها أولاً');
    if (p.status !== 'open') throw new PeriodClosedError();
    return p;
  }

  async nextNumber(tx: any, tenantId: string, docType: string, scope = ''): Promise<number> {
    await tx.$executeRaw`INSERT INTO document_sequences (tenant_id, doc_type, scope, last_number) VALUES (${tenantId}::uuid, ${docType}, ${scope}, 0) ON CONFLICT (tenant_id, doc_type, scope) DO NOTHING`;
    const rows = await tx.$queryRaw`UPDATE document_sequences SET last_number = last_number + 1 WHERE tenant_id = ${tenantId}::uuid AND doc_type = ${docType} AND scope = ${scope} RETURNING last_number`;
    return rows[0].last_number as number;
  }

  /** Posts a balanced journal atomically. Idempotent on (tenant, idempotencyKey) and (sourceType, sourceId) via caller key. */
  async postJournal(tenantId: string, input: { businessDate: string; description?: string; lines: JournalLineInput[]; sourceType?: string; sourceId?: string; idempotencyKey: string; createdBy?: string }) {
    return this.prisma.withTenant(tenantId, (tx: any) => this.postJournalTx(tx, tenantId, input));
  }
  /** Tx variant: lets sales/purchasing compose journal+stock+document in ONE transaction. */
  async postJournalTx(tx: any, tenantId: string, input: { businessDate: string; description?: string; lines: JournalLineInput[]; sourceType?: string; sourceId?: string; idempotencyKey: string; createdBy?: string }) {
    validateLines(input.lines);
    {
      const existing = await tx.journalEntry.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } }, include: { lines: true } });
      if (existing) return existing; // safe retry: original result, never re-post
      const date = new Date(input.businessDate);
      await this.assertPeriodOpen(tx, tenantId, date);
      for (const l of input.lines) {
        const acc = await tx.account.findUnique({ where: { id: l.accountId } });
        if (!acc || acc.tenantId !== tenantId || !acc.isActive) throw new ConfigurationError(`حساب غير موجود أو غير مفعّل: ${l.accountId}`);
      }
      const number = await this.nextNumber(tx, tenantId, 'journal');
      const entry = await tx.journalEntry.create({ data: { tenantId, number, businessDate: date, description: input.description ?? null, status: 'posted', sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null, idempotencyKey: input.idempotencyKey, createdBy: input.createdBy ?? null } });
      for (const l of input.lines)
        await tx.journalLine.create({ data: { tenantId, entryId: entry.id, accountId: l.accountId, debit: money(l.debit) as never, credit: money(l.credit) as never, branchId: l.branchId ?? null, warehouseId: l.warehouseId ?? null, representativeId: l.representativeId ?? null, costCenter: l.costCenter ?? null, partyId: l.partyId ?? null } });
      await tx.auditLog.create({ data: { tenantId, actorUserId: input.createdBy ?? null, action: 'journal.posted', entityType: 'journal_entry', entityId: entry.id } });
      return tx.journalEntry.findUnique({ where: { id: entry.id }, include: { lines: true } });
    }
  }

  async reverseJournal(tenantId: string, entryId: string, input: { businessDate: string; reason: string; createdBy?: string }) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const rows = await tx.$queryRaw`SELECT * FROM journal_entries WHERE id = ${entryId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
      const orig = rows[0];
      if (!orig) throw new ConflictError('القيد غير موجود');
      if (orig.status === 'reversed') throw new ConflictError('هذا القيد مُعكوس مسبقاً — لا يمكن عكسه مرتين');
      if (orig.reversal_of_id) throw new ConflictError('قيد العكس نفسه لا يُعكس؛ أنشئ قيد تصحيح');
      const already = await tx.journalEntry.findUnique({ where: { reversalOfId: entryId } });
      if (already) throw new ConflictError('يوجد قيد عكس لهذا القيد مسبقاً');
      const date = new Date(input.businessDate);
      await this.assertPeriodOpen(tx, tenantId, date);
      const lines = await tx.journalLine.findMany({ where: { entryId } });
      const number = await this.nextNumber(tx, tenantId, 'journal');
      const rev = await tx.journalEntry.create({ data: { tenantId, number, businessDate: date, description: `عكس قيد: ${input.reason}`, status: 'posted', sourceType: 'reversal', sourceId: entryId, reversalOfId: entryId, idempotencyKey: `reversal:${entryId}`, createdBy: input.createdBy ?? null } });
      for (const l of lines)
        await tx.journalLine.create({ data: { tenantId, entryId: rev.id, accountId: l.accountId, debit: l.credit, credit: l.debit, branchId: l.branchId, warehouseId: l.warehouseId, representativeId: l.representativeId, costCenter: l.costCenter, partyId: l.partyId } });
      await tx.journalEntry.update({ where: { id: entryId }, data: { status: 'reversed' } });
      await tx.auditLog.create({ data: { tenantId, actorUserId: input.createdBy ?? null, action: 'journal.reversed', entityType: 'journal_entry', entityId: entryId, after: { reversalId: rev.id, reason: input.reason } } });
      return rev;
    });
  }

  async trialBalance(tenantId: string, asOf: string) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const rows = await tx.$queryRaw`
        SELECT a.code, a.name, a.type, COALESCE(SUM(l.debit),0) AS debit, COALESCE(SUM(l.credit),0) AS credit
        FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id AND l.tenant_id = ${tenantId}::uuid
        LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.status IN ('posted','reversed') AND e.business_date <= ${asOf}::date
        WHERE a.tenant_id = ${tenantId}::uuid GROUP BY a.code, a.name, a.type ORDER BY a.code`;
      // Note: entry-status filter must apply to the line join; recompute safely below in JS from posted lines:
      const lines = await tx.journalLine.findMany({ where: { tenantId, entry: { businessDate: { lte: new Date(asOf) }, status: { in: ['posted','reversed'] } } }, include: { account: true } });
      const map = new Map<string, any>();
      for (const l of lines) {
        const k = l.account.code; const cur = map.get(k) ?? { code: k, name: l.account.name, type: l.account.type, debit: money(0), credit: money(0) };
        cur.debit = cur.debit.plus(money(l.debit.toString())); cur.credit = cur.credit.plus(money(l.credit.toString())); map.set(k, cur);
      }
      return [...map.values()].map(r => ({ ...r, debit: r.debit.toString(), credit: r.credit.toString(), balance: r.debit.minus(r.credit).toString() }));
    });
  }
}
