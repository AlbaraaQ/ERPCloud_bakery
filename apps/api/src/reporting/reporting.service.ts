import { Injectable } from '@nestjs/common';
import { money } from '@erpcloud/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { InventoryService } from '../inventory/inventory.service';

const inPeriod = (from: string, to: string) => ({ gte: new Date(from), lte: new Date(to) });

@Injectable()
export class ReportingService {
  constructor(private prisma: PrismaService, private acc: AccountingService, private inv: InventoryService) {}

  async incomeStatement(tenantId: string, from: string, to: string) {
    const tb = await this.prisma.withTenant(tenantId, async (tx: any) => {
      const lines = await tx.journalLine.findMany({ where: { tenantId, entry: { businessDate: inPeriod(from, to), status: { in: ['posted', 'reversed'] } } }, include: { account: true } });
      let revenue = money(0), expenses = money(0); const byAccount: Record<string, { name: string; type: string; amount: ReturnType<typeof money> }> = {};
      for (const l of lines) {
        const net = money(l.credit.toString()).minus(money(l.debit.toString())); // credit-positive for revenue
        if (l.account.type === 'revenue') { revenue = revenue.plus(net); const k = l.account.code; byAccount[k] = byAccount[k] ?? { name: l.account.name, type: 'revenue', amount: money(0) }; byAccount[k].amount = byAccount[k].amount.plus(net); }
        if (l.account.type === 'expense') { const e = money(l.debit.toString()).minus(money(l.credit.toString())); expenses = expenses.plus(e); const k = l.account.code; byAccount[k] = byAccount[k] ?? { name: l.account.name, type: 'expense', amount: money(0) }; byAccount[k].amount = byAccount[k].amount.plus(e); }
      }
      return { revenue, expenses, byAccount };
    });
    return { from, to, revenue: tb.revenue.toString(), expenses: tb.expenses.toString(), netProfit: tb.revenue.minus(tb.expenses).toString(), byAccount: Object.entries(tb.byAccount).map(([code, v]: [string, any]) => ({ code, name: v.name, type: v.type, amount: v.amount.toString() })) };
  }

  async balanceSheet(tenantId: string, asOf: string) {
    const rows = await this.acc.trialBalance(tenantId, asOf);
    const sum = (types: string[]) => rows.filter((r: any) => types.includes(r.type)).reduce((a: any, r: any) => a.plus(money(r.balance)), money(0));
    const assets = sum(['asset']); const liabilities = sum(['liability']); const equity = sum(['equity']);
    // Current-period profit belongs to equity until closing: revenue balances are credit
    // (negative), expenses debit (positive) in trial-balance signed terms.
    const profit = sum(['revenue', 'expense']).neg();
    const liabilitiesDisplay = liabilities.abs(); const equityDisplay = equity.abs().plus(profit);
    return { asOf, assets: assets.toString(), liabilities: liabilitiesDisplay.toString(), equity: equityDisplay.toString(), currentPeriodProfit: profit.toString(), balanced: assets.minus(liabilitiesDisplay).minus(equityDisplay).abs().lt('0.01'), accounts: rows };
  }

  async generalLedger(tenantId: string, accountCode: string, from: string, to: string) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const account = await tx.account.findFirst({ where: { tenantId, code: accountCode } });
      if (!account) return [];
      const lines = await tx.journalLine.findMany({ where: { tenantId, accountId: account.id, entry: { businessDate: inPeriod(from, to), status: { in: ['posted', 'reversed'] } } }, include: { entry: true }, orderBy: { entry: { businessDate: 'asc' } } });
      let running = money(0);
      return lines.map((l: any) => { running = running.plus(money(l.debit.toString()).minus(money(l.credit.toString()))); return { date: l.entry.businessDate, entryNumber: l.entry.number, description: l.entry.description, sourceType: l.entry.sourceType, sourceId: l.entry.sourceId, debit: l.debit.toString(), credit: l.credit.toString(), balance: running.toString() }; });
    });
  }

  async aging(tenantId: string, kind: 'customer' | 'supplier', asOf: string) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const bucket = (due: Date) => { const days = Math.floor((new Date(asOf).getTime() - due.getTime()) / 86400000); return days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'd90plus'; };
      const result: Record<string, ReturnType<typeof money>> = { current: money(0), d30: money(0), d60: money(0), d90: money(0), d90plus: money(0) };
      const details: any[] = [];
      if (kind === 'customer') {
        const invoices = await tx.salesInvoice.findMany({ where: { tenantId, accountingStatus: 'posted', paymentStatus: { in: ['unpaid', 'partially_paid'] } } });
        for (const inv of invoices) {
          const notes = await tx.creditNote.findMany({ where: { tenantId, originalInvoiceId: inv.id } });
          const returned = notes.reduce((a: any, n: any) => a.plus(money(n.total.toString())), money(0));
          const open = money(inv.total.toString()).minus(money(inv.paidAmount.toString())).minus(returned);
          if (open.lte(0)) continue;
          const party = inv.partyId ? await tx.party.findUnique({ where: { id: inv.partyId } }) : null;
          const due = new Date(inv.businessDate); due.setDate(due.getDate() + (party?.paymentTermsDays ?? 0));
          const b = bucket(due); result[b] = result[b].plus(open); details.push({ documentId: inv.id, number: inv.number, partyId: inv.partyId, dueDate: due.toISOString().slice(0, 10), open: open.toString(), bucket: b });
        }
      } else {
        const invoices = await tx.supplierInvoice.findMany({ where: { tenantId, accountingStatus: 'posted', paymentStatus: { in: ['unpaid', 'partially_paid'] } } });
        for (const inv of invoices) {
          const open = money(inv.total.toString()).minus(money(inv.paidAmount.toString()));
          if (open.lte(0)) continue;
          const party = await tx.party.findUnique({ where: { id: inv.partyId } });
          const due = new Date(inv.businessDate); due.setDate(due.getDate() + (party?.paymentTermsDays ?? 0));
          const b = bucket(due); result[b] = result[b].plus(open); details.push({ documentId: inv.id, number: inv.number, partyId: inv.partyId, dueDate: due.toISOString().slice(0, 10), open: open.toString(), bucket: b });
        }
      }
      return { asOf, kind, buckets: Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.toString()])), details };
    });
  }

  async salesReport(tenantId: string, from: string, to: string, groupBy: 'product' | 'representative' | 'party' = 'product') {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const lines = await tx.salesLine.findMany({ where: { tenantId, invoice: { accountingStatus: 'posted', businessDate: inPeriod(from, to) } }, include: { invoice: true } });
      const map = new Map<string, any>();
      for (const l of lines) {
        const key = groupBy === 'product' ? l.productId : groupBy === 'representative' ? (l.invoice.representativeId ?? 'backoffice') : (l.invoice.partyId ?? 'walk-in');
        const cur = map.get(key) ?? { key, qty: money(0), freeQty: money(0), net: money(0), tax: money(0), cost: money(0) };
        cur.qty = cur.qty.plus(money(l.qty.toString())); cur.freeQty = cur.freeQty.plus(money(l.freeQty.toString()));
        cur.net = cur.net.plus(money(l.lineTotal.toString()).minus(money(l.taxAmount.toString()))); cur.tax = cur.tax.plus(money(l.taxAmount.toString()));
        cur.cost = cur.cost.plus(money(l.unitCost.toString()).times(money(l.qty.toString()).plus(money(l.freeQty.toString()))));
        map.set(key, cur);
      }
      return [...map.values()].map(r => ({ key: r.key, qty: r.qty.toString(), freeQty: r.freeQty.toString(), net: r.net.toString(), tax: r.tax.toString(), cost: r.cost.toString(), grossProfit: r.net.minus(r.cost).toString() }));
    });
  }

  async inventoryValuation(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const bals = await tx.stockBalance.findMany({ where: { tenantId } });
      let total = money(0); const rows = bals.map((b: any) => { total = total.plus(money(b.value.toString())); return { productId: b.productId, warehouseId: b.warehouseId, qty: b.qty.toString(), avgCost: b.avgCost.toString(), value: b.value.toString() }; });
      return { total: total.toString(), rows };
    });
  }

  /** Automated reconciliation checks — every difference must be zero (REPORTING_SPECIFICATION). */
  async reconciliations(tenantId: string, asOf: string) {
    const tb = await this.acc.trialBalance(tenantId, asOf);
    const debit = tb.reduce((a: any, r: any) => a.plus(money(r.debit)), money(0)); const credit = tb.reduce((a: any, r: any) => a.plus(money(r.credit)), money(0));
    const valuation = await this.inventoryValuation(tenantId);
    const drift = await this.inv.reconcile(tenantId);
    const glInventory = await this.prisma.withTenant(tenantId, async (tx: any) => {
      const m = await tx.accountMapping.findUnique({ where: { tenantId_purpose: { tenantId, purpose: 'INVENTORY' } } }).catch(() => null);
      if (!m) return null;
      const lines = await tx.journalLine.findMany({ where: { tenantId, accountId: m.accountId, entry: { status: { in: ['posted', 'reversed'] } } } });
      return lines.reduce((a: any, l: any) => a.plus(money(l.debit.toString()).minus(money(l.credit.toString()))), money(0));
    });
    return {
      trialBalanceDifference: debit.minus(credit).toString(),
      stockLedgerDriftRows: drift.length,
      inventoryValuation: valuation.total,
      glInventoryAccount: glInventory?.toString() ?? null,
      inventoryDifference: glInventory ? glInventory.minus(money(valuation.total)).toString() : null,
    };
  }

  async dashboard(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const [openSettlements, failedTax, rejectedSync, lowStock, pendingTransfers] = await Promise.all([
        tx.settlement.count({ where: { tenantId, status: { in: ['requested', 'under_review'] } } }),
        tx.taxSubmission.count({ where: { tenantId, status: { in: ['failed', 'rejected'] } } }),
        tx.syncOperation.count({ where: { tenantId, status: { in: ['rejected', 'conflict'] } } }),
        tx.stockBalance.count({ where: { tenantId, qty: { lt: 10 } } }),
        tx.stockTransfer.count({ where: { tenantId, status: { in: ['dispatched', 'partially_received', 'disputed'] } } }),
      ]);
      const now = new Date(); const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const [salesTodayAgg, salesMonthAgg, invoicesCount, customersCount, productsCount] = await Promise.all([
        tx.salesInvoice.aggregate({ where: { tenantId, accountingStatus: 'posted', businessDate: { gte: new Date(now.toISOString().slice(0, 10)) } }, _sum: { total: true } }),
        tx.salesInvoice.aggregate({ where: { tenantId, accountingStatus: 'posted', businessDate: { gte: monthStart } }, _sum: { total: true } }),
        tx.salesInvoice.count({ where: { tenantId } }),
        tx.party.count({ where: { tenantId, kind: { in: ['customer', 'both'] } } }),
        tx.product.count({ where: { tenantId, isActive: true } }),
      ]);
      return { openSettlements, failedTaxSubmissions: failedTax, rejectedSyncOps: rejectedSync, lowStockRows: lowStock, pendingTransfers,
        salesToday: salesTodayAgg._sum.total?.toString() ?? '0', salesThisMonth: salesMonthAgg._sum.total?.toString() ?? '0',
        invoicesCount, customersCount, productsCount };
    });
  }
}
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [headers.join(','), ...rows.map(r => headers.map(h => cell(r[h])).join(','))].join('\n');
}
