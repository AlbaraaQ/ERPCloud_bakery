import { Injectable } from '@nestjs/common';
import { money, qMoney } from '@erpcloud/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { InventoryService } from '../inventory/inventory.service';
import { lineAmounts } from '../sales/pricing';

@Injectable()
export class PurchasingService {
  constructor(private prisma: PrismaService, private acc: AccountingService, private inv: InventoryService) {}
  /** Goods receipt + supplier invoice in one atomic posting: stock in at cost, Dr Inventory (+VAT input), Cr AP. */
  async postSupplierInvoice(tenantId: string, input: { partyId: string; warehouseId: string; businessDate: string; idempotencyKey: string; lines: { productId: string; qty: string; unitCost: string; lotId?: string; taxRate?: string }[]; createdBy?: string }) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const dup = await tx.supplierInvoice.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } }, include: { lines: true } });
      if (dup) return dup;
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      let subtotal = money(0), taxTotal = money(0);
      const inv = await tx.supplierInvoice.create({ data: { tenantId, partyId: input.partyId, warehouseId: input.warehouseId, businessDate: new Date(input.businessDate), idempotencyKey: input.idempotencyKey, createdBy: input.createdBy ?? null } });
      for (const l of input.lines) {
        const rate = tenant.vatRegistered ? money(l.taxRate ?? '0') : money(0);
        const net = money(l.qty).times(money(l.unitCost)); const tax = net.times(rate).div(100);
        subtotal = subtotal.plus(net); taxTotal = taxTotal.plus(tax);
        await tx.supplierLine.create({ data: { tenantId, invoiceId: inv.id, productId: l.productId, lotId: l.lotId ?? null, qty: money(l.qty) as never, unitCost: money(l.unitCost) as never, taxRate: rate as never, taxAmount: qMoney(tax) as never, lineTotal: qMoney(net.plus(tax)) as never } });
        await this.inv.postMovementTx(tx, tenantId, { productId: l.productId, warehouseId: input.warehouseId, lotId: l.lotId, type: 'purchase_receipt', qty: l.qty, unitCost: l.unitCost, sourceType: 'supplier_invoice', sourceId: inv.id, idempotencyKey: `${input.idempotencyKey}:in:${l.productId}`, businessDate: input.businessDate, createdBy: input.createdBy });
      }
      const total = subtotal.plus(taxTotal);
      const invAcc = await this.acc.resolveAccount(tx, tenantId, 'INVENTORY');
      const apAcc = await this.acc.resolveAccount(tx, tenantId, 'AP_SUPPLIER');
      const lines: any[] = [{ accountId: invAcc, debit: qMoney(subtotal).toString(), credit: '0' }];
      if (taxTotal.gt(0)) { const vatIn = await this.acc.resolveAccount(tx, tenantId, 'VAT_INPUT'); lines.push({ accountId: vatIn, debit: qMoney(taxTotal).toString(), credit: '0' }); }
      lines.push({ accountId: apAcc, debit: '0', credit: qMoney(total).toString(), partyId: input.partyId });
      const entry = await this.acc.postJournalTx(tx, tenantId, { businessDate: input.businessDate, description: 'فاتورة مورد', lines, sourceType: 'supplier_invoice', sourceId: inv.id, idempotencyKey: `${input.idempotencyKey}:journal`, createdBy: input.createdBy });
      const number = await this.acc.nextNumber(tx, tenantId, 'supplier_invoice');
      await tx.supplierInvoice.update({ where: { id: inv.id }, data: { number, subtotal: qMoney(subtotal) as never, taxTotal: qMoney(taxTotal) as never, total: qMoney(total) as never, journalEntryId: entry.id } });
      void lineAmounts;
      return tx.supplierInvoice.findUnique({ where: { id: inv.id }, include: { lines: true } });
    });
  }
}
