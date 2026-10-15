import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { AccountingService } from '../src/accounting/accounting.service';
import { InventoryService } from '../src/inventory/inventory.service';
import { PartiesService } from '../src/parties/parties.service';
import { SalesService } from '../src/sales/sales.service';
import { PurchasingService } from '../src/purchasing/purchasing.service';
import { TaxService } from '../src/tax/tax.service';

const run = process.env.RUN_INTEGRATION === '1';
// Test double at the documented gateway boundary: behaves like a sandbox response, records calls.
class FakeGateway {
  calls: any[] = []; mode: 'ok' | 'fail-once' | 'reject' = 'ok'; failures = 0;
  async submit(input: any) {
    this.calls.push(input);
    if (this.failures > 0) { this.failures--; throw new Error('network timeout (simulated)'); }
    if (this.mode === 'reject') return { accepted: false, status: 'rejected' as const, responseCode: '400', reference: 'validation error (simulated)' };
    return { accepted: true, status: input.kind.startsWith('standard') ? 'cleared' as const : 'reported' as const, reference: 'SANDBOX-REF-1', responseCode: '200' };
  }
}
describe.skipIf(!run)('Phase6 tax/ZATCA boundary (fake sandbox gateway)', () => {
  const prisma = new PrismaService();
  const auth = new AuthService(prisma, new AuditService(prisma));
  const acc = new AccountingService(prisma); const inv = new InventoryService(prisma);
  const parties = new PartiesService(prisma, acc);
  const sales = new SalesService(prisma, acc, inv, parties);
  const purch = new PurchasingService(prisma, acc, inv);
  const gateway = new FakeGateway();
  const tax = new TaxService(prisma, gateway as never);
  const slug = 'p6-' + Math.random().toString(36).slice(2, 8);
  let T = '', WH = '', P = '', b2c = '', b2b = '', supplier = '', invoiceId = '';

  beforeAll(async () => {
    const r = await auth.createTenantWithOwner({ tenantName: 'P6', slug, email: 'o@p6.test', password: 'Strong-Pass-123!', displayName: 'O' });
    T = r.tenantId;
    await prisma.withTenant(T, async (tx: any) => {
      const mk = async (code: string, type: string) => (await tx.account.create({ data: { tenantId: T, code, name: code, type } })).id;
      const A: Record<string, string> = {};
      for (const [c, t] of [['100','asset'],['110','asset'],['120','asset'],['200','liability'],['210','liability'],['400','revenue'],['500','expense']] as const) A[c] = await mk(c, t);
      const map: Record<string, string> = { CASH_ON_HAND: A['100'], AR_CUSTOMER: A['110'], INVENTORY: A['120'], AP_SUPPLIER: A['200'], VAT_OUTPUT: A['210'], VAT_INPUT: A['210'], SALES_REVENUE: A['400'], COGS: A['500'], FREE_GOODS_EXPENSE: A['500'] };
      for (const [purpose, accountId] of Object.entries(map)) await tx.accountMapping.create({ data: { tenantId: T, purpose, accountId } });
      const fy = await tx.fiscalYear.create({ data: { tenantId: T, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
      await tx.accountingPeriod.create({ data: { tenantId: T, fiscalYearId: fy.id, name: '2026-10', startDate: new Date('2026-10-01'), endDate: new Date('2026-10-31') } });
      const unit = await tx.unitOfMeasure.create({ data: { tenantId: T, code: 'pcs', name: 'حبة' } });
      P = (await tx.product.create({ data: { tenantId: T, sku: 'BREAD', nameAr: 'خبز', stockUnitId: unit.id, defaultPrice: '10', taxRate: '15' } })).id;
      WH = (await tx.warehouse.create({ data: { tenantId: T, code: 'WH', name: 'رئيسي' } })).id;
      b2c = (await tx.party.create({ data: { tenantId: T, kind: 'customer', name: 'عميل أفراد', creditLimit: '10000' } })).id;
      b2b = (await tx.party.create({ data: { tenantId: T, kind: 'customer', name: 'شركة', taxNumber: '310000000000003', creditLimit: '10000' } })).id;
      supplier = (await tx.party.create({ data: { tenantId: T, kind: 'supplier', name: 'مورد' } })).id;
    });
    await purch.postSupplierInvoice(T, { partyId: supplier, warehouseId: WH, businessDate: '2026-10-01', idempotencyKey: 'p6-buy', lines: [{ productId: P, qty: '100', unitCost: '4' }] });
    await tax.configure(T, { vatRegistered: true, vatNumber: '300000000000003' });
    await tax.registerCredential(T, { environment: 'sandbox', secretRef: 'secret-store/zatca/sandbox' });
  });

  it('simplified invoice: reported via gateway, QR built, resubmit idempotent', async () => {
    const sale = await sales.createInvoice(T, { partyId: b2c, warehouseId: WH, businessDate: '2026-10-10', idempotencyKey: 'p6-sale-1', lines: [{ productId: P, qty: '2' }], payments: [{ method: 'cash', amount: '23' }] }, { post: true });
    invoiceId = sale.id;
    const sub = await tax.submitInvoice(T, invoiceId);
    expect(sub.status).toBe('reported'); expect(sub.kind).toBe('simplified'); expect(sub.qrPayload).toBeTruthy(); expect(sub.icv).toBe(1);
    const inv2 = await prisma.withTenant(T, (tx: any) => tx.salesInvoice.findUnique({ where: { id: invoiceId } }));
    expect(inv2.taxStatus).toBe('reported');
    const again = await tax.submitInvoice(T, invoiceId);
    expect(again.id).toBe(sub.id); expect(gateway.calls).toHaveLength(1); // no duplicate issuance
  });

  it('network failure keeps pending status, retry reuses same UUID/hash and succeeds (AT-TAX-002)', async () => {
    gateway.failures = 1;
    const sale = await sales.createInvoice(T, { partyId: b2b, warehouseId: WH, businessDate: '2026-10-10', idempotencyKey: 'p6-sale-2', lines: [{ productId: P, qty: '1' }], payments: [{ method: 'cash', amount: '11.5' }] }, { post: true });
    const first = await tax.submitInvoice(T, sale.id);
    expect(first.status).toBe('failed'); expect(first.kind).toBe('standard');
    const invMid = await prisma.withTenant(T, (tx: any) => tx.salesInvoice.findUnique({ where: { id: sale.id } }));
    expect(invMid.taxStatus).toBe('pending_clearance'); // never falsely cleared
    gateway.mode = 'ok';
    const second = await tax.submitInvoice(T, sale.id);
    expect(second.status).toBe('cleared'); expect(second.uuid).toBe(first.uuid); expect(second.invoiceHash).toBe(first.invoiceHash); expect(second.icv).toBe(first.icv);
  });

  it('official rejection records rejected, period summary reconciles by rate', async () => {
    gateway.mode = 'reject';
    const sale = await sales.createInvoice(T, { partyId: b2c, warehouseId: WH, businessDate: '2026-10-10', idempotencyKey: 'p6-sale-3', lines: [{ productId: P, qty: '1' }], payments: [{ method: 'cash', amount: '11.5' }] }, { post: true });
    const sub = await tax.submitInvoice(T, sale.id);
    expect(sub.status).toBe('rejected');
    gateway.mode = 'ok';
    const summary = await tax.periodSummary(T, '2026-10-01', '2026-10-31');
    const r15 = summary.find((x: any) => x.rate === '15');
    expect(r15.tax).toBe('6'); // (2+1+1 items)*10*15% = 6
  });
});
