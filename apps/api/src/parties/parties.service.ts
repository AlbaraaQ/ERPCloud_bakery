import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { money } from '@erpcloud/shared';

@Injectable()
export class PartiesService {
  constructor(private prisma: PrismaService, private acc: AccountingService) {}
  create(tenantId: string, input: { kind: string; name: string; phone?: string; taxNumber?: string; creditLimit?: string; creditHold?: boolean; priceListId?: string }) {
    return this.prisma.withTenant(tenantId, (tx: any) => tx.party.create({ data: { tenantId, kind: input.kind, name: input.name, phone: input.phone ?? null, taxNumber: input.taxNumber ?? null, creditLimit: money(input.creditLimit ?? '0') as never, creditHold: input.creditHold ?? false, priceListId: input.priceListId ?? null } }));
  }
  /** Subledger balance from GL lines carrying partyId on the AR/AP control account. Positive = receivable (customer) / payable sign per account. */
  async balance(tx: any, tenantId: string, partyId: string): Promise<ReturnType<typeof money>> {
    const arId = await this.acc.resolveAccount(tx, tenantId, 'AR_CUSTOMER').catch(() => null);
    const apId = await this.acc.resolveAccount(tx, tenantId, 'AP_SUPPLIER').catch(() => null);
    let bal = money(0);
    for (const [accountId, sign] of [[arId, 1], [apId, -1]] as const) {
      if (!accountId) continue;
      const lines = await tx.journalLine.findMany({ where: { tenantId, partyId, accountId, entry: { status: { in: ['posted', 'reversed'] } } } });
      for (const l of lines) bal = bal.plus(money(l.debit.toString()).minus(money(l.credit.toString())).times(sign));
    }
    return bal;
  }
  async statement(tenantId: string, partyId: string) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const lines = await tx.journalLine.findMany({ where: { tenantId, partyId, entry: { status: { in: ['posted', 'reversed'] } } }, include: { entry: true }, orderBy: { entry: { businessDate: 'asc' } } });
      let running = money(0);
      return lines.map((l: any) => { running = running.plus(money(l.debit.toString()).minus(money(l.credit.toString()))); return { date: l.entry.businessDate, entryId: l.entryId, description: l.entry.description, debit: l.debit.toString(), credit: l.credit.toString(), balance: running.toString() }; });
    });
  }
}
