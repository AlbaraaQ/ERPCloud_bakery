import { Injectable } from '@nestjs/common';
import { ConfigurationError, ForbiddenError, DomainError, money, qMoney } from '@erpcloud/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { InventoryService } from '../inventory/inventory.service';
import { PartiesService } from '../parties/parties.service';
import { checkPrice, lineAmounts } from './pricing';

export interface SaleLineInput { productId: string; qty: string; freeQty?: string; requestedPrice?: string; discount?: string; lotId?: string; overrideApprovedBy?: string; overrideReason?: string; }
export interface SaleInput { partyId?: string; warehouseId: string; representativeId?: string; businessDate: string; idempotencyKey: string; lines: SaleLineInput[]; payments?: { method: string; amount: string }[]; }

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService, private acc: AccountingService, private inv: InventoryService, private parties: PartiesService) {}

  async createInvoice(tenantId: string, input: SaleInput, opts: { post: boolean; createdBy?: string; allowPriceOverride?: boolean }) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const existing = await tx.salesInvoice.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } }, include: { lines: true } });
      if (existing) return existing;
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      const party = input.partyId ? await tx.party.findUnique({ where: { id: input.partyId } }) : null;
      if (input.partyId && (!party || party.tenantId !== tenantId)) throw new DomainError('PARTY_NOT_FOUND', 'العميل غير موجود');
      // --- price & amount computation (server-side; client prices are hints only) ---
      const computed: any[] = [];
      let subtotal = money(0), discountTotal = money(0), taxTotal = money(0);
      for (const l of input.lines) {
        const product = await tx.product.findUnique({ where: { id: l.productId } });
        if (!product || product.tenantId !== tenantId || !product.isActive) throw new ConfigurationError('منتج غير موجود أو غير مفعّل');
        let resolved = money(product.defaultPrice.toString());
        if (party?.priceListId) {
          const item = await tx.priceListItem.findFirst({ where: { tenantId, priceListId: party.priceListId, productId: l.productId, effectiveFrom: { lte: new Date(input.businessDate) }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date(input.businessDate) } }] }, orderBy: { effectiveFrom: 'desc' } });
          if (item) resolved = money(item.price.toString());
        }
        const chk = checkPrice({ resolvedPrice: resolved.toString(), minPrice: product.minPrice?.toString(), maxPrice: product.maxPrice?.toString(), requestedPrice: l.requestedPrice });
        if (chk.outOfBounds && !(opts.allowPriceOverride && l.overrideApprovedBy && l.overrideReason))
          throw new ForbiddenError(`السعر ${chk.requested} خارج الحدود المسموحة للمنتج — يتطلب اعتماداً موثقاً بسبب. Price override requires approval and reason`);
        let taxRate = money(0);
        if (tenant.vatRegistered) {
          if (product.taxRate === null || product.taxRate === undefined) throw new ConfigurationError(`نسبة الضريبة غير مُكوَّنة للمنتج ${product.sku} — لن يتم تخمينها`);
          taxRate = money(product.taxRate.toString());
        }
        const discount = money(l.discount ?? '0');
        const amt = lineAmounts(l.qty, chk.requested.toString(), discount.toString(), taxRate.toString());
        subtotal = subtotal.plus(money(l.qty).times(chk.requested)); discountTotal = discountTotal.plus(discount); taxTotal = taxTotal.plus(amt.tax);
        computed.push({ l, product, resolved, requested: chk.requested, taxRate, amt });
      }
      const total = subtotal.minus(discountTotal).plus(taxTotal);
      const paid = (input.payments ?? []).reduce((a, p) => a.plus(money(p.amount)), money(0));
      if (paid.gt(total)) throw new DomainError('OVERPAYMENT', 'المبلغ المدفوع أكبر من إجمالي الفاتورة — سجّله كدفعة مقدمة منفصلة');
      const remainder = total.minus(paid);
      // --- invoice header (draft first so its id is the journal/movement source) ---
      const invoice = await tx.salesInvoice.create({ data: { tenantId, partyId: input.partyId ?? null, warehouseId: input.warehouseId, representativeId: input.representativeId ?? null, businessDate: new Date(input.businessDate), commercialStatus: 'draft', subtotal: qMoney(subtotal) as never, discountTotal: qMoney(discountTotal) as never, taxTotal: qMoney(taxTotal) as never, total: qMoney(total) as never, paidAmount: qMoney(paid) as never, idempotencyKey: input.idempotencyKey, createdBy: opts.createdBy ?? null } });
      for (const c of computed)
        await tx.salesLine.create({ data: { tenantId, invoiceId: invoice.id, productId: c.l.productId, lotId: c.l.lotId ?? null, qty: money(c.l.qty) as never, freeQty: money(c.l.freeQty ?? '0') as never, originalPrice: qMoney(c.resolved) as never, unitPrice: qMoney(c.requested) as never, discount: qMoney(money(c.l.discount ?? '0')) as never, taxRate: c.taxRate as never, taxAmount: qMoney(c.amt.tax) as never, lineTotal: qMoney(c.amt.total) as never, overrideReason: c.l.overrideReason ?? null, overrideApprovedBy: c.l.overrideApprovedBy ?? null } });
      if (!opts.post) return tx.salesInvoice.findUnique({ where: { id: invoice.id }, include: { lines: true } });
      return this.postEffects(tx, tenantId, invoice, computed, input, { paid, total, subtotal, discountTotal, taxTotal, party, createdBy: opts.createdBy });
    });
  }

  private async postEffects(tx: any, tenantId: string, invoice: any, computed: any[], input: SaleInput, sums: any) {
    const { paid, total, taxTotal, party } = sums;
    const remainder = total.minus(paid);
    if (remainder.gt(0)) {
      if (!party) throw new DomainError('CREDIT_NEEDS_CUSTOMER', 'البيع الآجل يتطلب اختيار عميل — العميل العابر يدفع كاملاً');
      if (party.creditHold) throw new DomainError('CREDIT_HOLD', 'حساب العميل موقوف ائتمانياً');
      const bal = await this.parties.balance(tx, tenantId, party.id);
      if (money(party.creditLimit.toString()).lt(bal.plus(remainder))) throw new DomainError('CREDIT_LIMIT_EXCEEDED', `تجاوز حد الائتمان: الحالي ${bal} + الجديد ${remainder} > الحد ${party.creditLimit}`);
    }
    // stock out + cost capture
    let paidCost = money(0), freeCost = money(0);
    for (const c of computed) {
      const outQty = money(c.l.qty).plus(money(c.l.freeQty ?? '0'));
      if (outQty.lte(0)) continue;
      const m = await this.inv.postMovementTx(tx, tenantId, { productId: c.l.productId, warehouseId: input.warehouseId, lotId: c.l.lotId, type: 'sale', qty: outQty.neg().toString(), sourceType: 'sales_invoice', sourceId: invoice.id, idempotencyKey: `${input.idempotencyKey}:stock:${c.l.productId}`, businessDate: input.businessDate, createdBy: sums.createdBy });
      const uc = money(m.unitCost.toString());
      paidCost = paidCost.plus(uc.times(money(c.l.qty))); freeCost = freeCost.plus(uc.times(money(c.l.freeQty ?? '0')));
      await tx.salesLine.updateMany({ where: { invoiceId: invoice.id, productId: c.l.productId }, data: { unitCost: qMoney(uc) as never } });
    }
    // journal
    const cashAcc = await this.acc.resolveAccount(tx, tenantId, 'CASH_ON_HAND');
    const arAcc = await this.acc.resolveAccount(tx, tenantId, 'AR_CUSTOMER');
    const revAcc = await this.acc.resolveAccount(tx, tenantId, 'SALES_REVENUE');
    const invAcc = await this.acc.resolveAccount(tx, tenantId, 'INVENTORY');
    const cogsAcc = await this.acc.resolveAccount(tx, tenantId, 'COGS');
    const net = sums.subtotal.minus(sums.discountTotal);
    const lines: any[] = [];
    if (paid.gt(0)) lines.push({ accountId: cashAcc, debit: qMoney(paid).toString(), credit: '0' });
    if (remainder.gt(0)) lines.push({ accountId: arAcc, debit: qMoney(remainder).toString(), credit: '0', partyId: party.id });
    lines.push({ accountId: revAcc, debit: '0', credit: qMoney(net).toString() });
    if (taxTotal.gt(0)) { const vatAcc = await this.acc.resolveAccount(tx, tenantId, 'VAT_OUTPUT'); lines.push({ accountId: vatAcc, debit: '0', credit: qMoney(taxTotal).toString() }); }
    const costTotal = paidCost.plus(freeCost);
    if (costTotal.gt(0)) {
      if (paidCost.gt(0)) lines.push({ accountId: cogsAcc, debit: qMoney(paidCost).toString(), credit: '0' });
      if (freeCost.gt(0)) { const fgAcc = await this.acc.resolveAccount(tx, tenantId, 'FREE_GOODS_EXPENSE'); lines.push({ accountId: fgAcc, debit: qMoney(freeCost).toString(), credit: '0' }); }
      lines.push({ accountId: invAcc, debit: '0', credit: qMoney(costTotal).toString() });
    }
    const entry = await this.acc.postJournalTx(tx, tenantId, { businessDate: input.businessDate, description: `فاتورة مبيعات`, lines, sourceType: 'sales_invoice', sourceId: invoice.id, idempotencyKey: `${input.idempotencyKey}:journal`, createdBy: sums.createdBy });
    const number = await this.acc.nextNumber(tx, tenantId, 'sales_invoice');
    // payments + allocations
    for (const p of input.payments ?? []) {
      const pay = await tx.payment.create({ data: { tenantId, partyId: party?.id ?? null, direction: 'in', method: p.method, amount: qMoney(money(p.amount)) as never, businessDate: new Date(input.businessDate), settlementStatus: p.method === 'electronic' ? 'pending' : 'settled', idempotencyKey: `${input.idempotencyKey}:pay:${p.method}:${p.amount}`, createdBy: sums.createdBy ?? null } });
      await tx.paymentAllocation.create({ data: { tenantId, paymentId: pay.id, documentType: 'sales_invoice', documentId: invoice.id, amount: qMoney(money(p.amount)) as never } });
    }
    const updated = await tx.salesInvoice.update({ where: { id: invoice.id }, data: { number, commercialStatus: 'issued', inventoryStatus: 'posted', accountingStatus: 'posted', taxStatus: taxTotal.gt(0) ? 'pending_reporting' : 'not_required', paymentStatus: remainder.isZero() ? 'paid' : paid.gt(0) ? 'partially_paid' : 'unpaid', journalEntryId: entry.id } });
    await tx.auditLog.create({ data: { tenantId, actorUserId: sums.createdBy ?? null, action: 'sales.posted', entityType: 'sales_invoice', entityId: invoice.id } });
    return tx.salesInvoice.findUnique({ where: { id: updated.id }, include: { lines: true } });
  }

  async postDraft(tenantId: string, invoiceId: string, input: { payments?: { method: string; amount: string }[]; createdBy?: string }) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const inv = await tx.salesInvoice.findUnique({ where: { id: invoiceId }, include: { lines: true } });
      if (!inv || inv.tenantId !== tenantId) throw new DomainError('NOT_FOUND', 'الفاتورة غير موجودة');
      if (inv.accountingStatus === 'posted') return inv; // idempotent
      const party = inv.partyId ? await tx.party.findUnique({ where: { id: inv.partyId } }) : null;
      const computed = inv.lines.map((l: any) => ({ l: { productId: l.productId, qty: l.qty.toString(), freeQty: l.freeQty.toString(), lotId: l.lotId }, product: null, amt: null }));
      const sums = { paid: (input.payments ?? []).reduce((a, p) => a.plus(money(p.amount)), money(0)), total: money(inv.total.toString()), subtotal: money(inv.subtotal.toString()), discountTotal: money(inv.discountTotal.toString()), taxTotal: money(inv.taxTotal.toString()), party, createdBy: input.createdBy };
      return this.postEffects(tx, tenantId, inv, computed, { partyId: inv.partyId, warehouseId: inv.warehouseId, businessDate: inv.businessDate.toISOString().slice(0, 10), idempotencyKey: inv.idempotencyKey, lines: [], payments: input.payments }, sums);
    });
  }

  async createReturn(tenantId: string, input: { originalInvoiceId: string; warehouseId: string; businessDate: string; idempotencyKey: string; lines: { productId: string; qty: string }[]; createdBy?: string }) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const dup = await tx.creditNote.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } } });
      if (dup) return dup;
      const orig = await tx.salesInvoice.findUnique({ where: { id: input.originalInvoiceId }, include: { lines: true } });
      if (!orig || orig.accountingStatus !== 'posted') throw new DomainError('INVALID_RETURN', 'الإرجاع يتطلب فاتورة مرحّلة');
      let total = money(0), taxTotal = money(0); const noteLines: any[] = [];
      const revAcc = await this.acc.resolveAccount(tx, tenantId, 'SALES_REVENUE');
      const arAcc = await this.acc.resolveAccount(tx, tenantId, 'AR_CUSTOMER');
      const invAcc = await this.acc.resolveAccount(tx, tenantId, 'INVENTORY');
      const cogsAcc = await this.acc.resolveAccount(tx, tenantId, 'COGS');
      let costBack = money(0);
      for (const rl of input.lines) {
        const ol = orig.lines.find((x: any) => x.productId === rl.productId);
        if (!ol) throw new DomainError('INVALID_RETURN', 'منتج غير موجود في الفاتورة الأصلية');
        if (money(rl.qty).gt(money(ol.qty.toString()))) throw new DomainError('INVALID_RETURN', 'كمية الإرجاع أكبر من المباعة');
        const amt = lineAmounts(rl.qty, ol.unitPrice.toString(), '0', ol.taxRate.toString());
        total = total.plus(amt.total); taxTotal = taxTotal.plus(amt.tax);
        costBack = costBack.plus(money(ol.unitCost.toString()).times(money(rl.qty)));
        noteLines.push({ productId: rl.productId, qty: rl.qty, unitPrice: ol.unitPrice, taxRate: ol.taxRate, lineTotal: amt.total });
        await this.inv.postMovementTx(tx, tenantId, { productId: rl.productId, warehouseId: input.warehouseId, type: 'sale_return', qty: rl.qty, unitCost: ol.unitCost.toString(), sourceType: 'credit_note', sourceId: orig.id, idempotencyKey: `${input.idempotencyKey}:in:${rl.productId}`, businessDate: input.businessDate, createdBy: input.createdBy });
      }
      const net = total.minus(taxTotal);
      const lines: any[] = [{ accountId: revAcc, debit: qMoney(net).toString(), credit: '0' }];
      if (taxTotal.gt(0)) { const vatAcc = await this.acc.resolveAccount(tx, tenantId, 'VAT_OUTPUT'); lines.push({ accountId: vatAcc, debit: qMoney(taxTotal).toString(), credit: '0' }); }
      lines.push({ accountId: arAcc, debit: '0', credit: qMoney(total).toString(), partyId: orig.partyId ?? undefined });
      if (costBack.gt(0)) { lines.push({ accountId: invAcc, debit: qMoney(costBack).toString(), credit: '0' }); lines.push({ accountId: cogsAcc, debit: '0', credit: qMoney(costBack).toString() }); }
      const entry = await this.acc.postJournalTx(tx, tenantId, { businessDate: input.businessDate, description: 'إشعار دائن — إرجاع مبيعات', lines, sourceType: 'credit_note', sourceId: orig.id, idempotencyKey: `${input.idempotencyKey}:journal`, createdBy: input.createdBy });
      const number = await this.acc.nextNumber(tx, tenantId, 'credit_note');
      const note = await tx.creditNote.create({ data: { tenantId, number, originalInvoiceId: orig.id, partyId: orig.partyId, businessDate: new Date(input.businessDate), total: qMoney(total) as never, taxTotal: qMoney(taxTotal) as never, journalEntryId: entry.id, idempotencyKey: input.idempotencyKey, createdBy: input.createdBy ?? null } });
      for (const nl of noteLines) await tx.creditNoteLine.create({ data: { tenantId, noteId: note.id, productId: nl.productId, warehouseId: input.warehouseId, qty: money(nl.qty) as never, unitPrice: qMoney(money(nl.unitPrice.toString())) as never, taxRate: nl.taxRate as never, lineTotal: qMoney(nl.lineTotal) as never } });
      await tx.salesInvoice.update({ where: { id: orig.id }, data: { commercialStatus: 'partially_returned' } });
      return note;
    });
  }
}
