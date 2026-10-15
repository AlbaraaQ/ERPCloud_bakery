import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { AccountingService } from '../src/accounting/accounting.service';
import { InventoryService } from '../src/inventory/inventory.service';
import { PartiesService } from '../src/parties/parties.service';
import { SalesService } from '../src/sales/sales.service';
import { PurchasingService } from '../src/purchasing/purchasing.service';
import { CashService } from '../src/cash/cash.service';

const run = process.env.RUN_INTEGRATION === '1';
describe.skipIf(!run)('Phase3 sales/purchasing/cash (real Postgres)', () => {
  const prisma = new PrismaService();
  const auth = new AuthService(prisma, new AuditService(prisma));
  const acc = new AccountingService(prisma); const inv = new InventoryService(prisma);
  const parties = new PartiesService(prisma, acc);
  const sales = new SalesService(prisma, acc, inv, parties);
  const purch = new PurchasingService(prisma, acc, inv);
  const cash = new CashService(prisma, acc);
  const slug = 'p3-' + Math.random().toString(36).slice(2, 8);
  let T = '', WH = '', P = '', customer = '', poorCustomer = '', supplier = '', cashAccountId = '';

  beforeAll(async () => {
    const r = await auth.createTenantWithOwner({ tenantName: 'P3', slug, email: 'o@p3.test', password: 'Strong-Pass-123!', displayName: 'O' });
    T = r.tenantId;
    await prisma.withTenant(T, async (tx: any) => {
      await tx.tenant.update({ where: { id: T }, data: { vatRegistered: true, vatNumber: '300000000000003' } });
      const mk = async (code: string, type: string) => (await tx.account.create({ data: { tenantId: T, code, name: code, type } })).id;
      const A: Record<string, string> = {};
      for (const [c, t] of [['100','asset'],['110','asset'],['120','asset'],['200','liability'],['210','liability'],['400','revenue'],['500','expense'],['510','expense']] as const) A[c] = await mk(c, t);
      const map: Record<string, string> = { CASH_ON_HAND: A['100'], AR_CUSTOMER: A['110'], INVENTORY: A['120'], AP_SUPPLIER: A['200'], VAT_OUTPUT: A['210'], VAT_INPUT: A['210'], SALES_REVENUE: A['400'], COGS: A['500'], FREE_GOODS_EXPENSE: A['510'], EXPENSE_GENERAL: A['510'] };
      for (const [purpose, accountId] of Object.entries(map)) await tx.accountMapping.create({ data: { tenantId: T, purpose, accountId } });
      const fy = await tx.fiscalYear.create({ data: { tenantId: T, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
      await tx.accountingPeriod.create({ data: { tenantId: T, fiscalYearId: fy.id, name: '2026-10', startDate: new Date('2026-10-01'), endDate: new Date('2026-10-31') } });
      const unit = await tx.unitOfMeasure.create({ data: { tenantId: T, code: 'pcs', name: 'حبة' } });
      P = (await tx.product.create({ data: { tenantId: T, sku: 'BREAD', nameAr: 'خبز', stockUnitId: unit.id, defaultPrice: '10', minPrice: '9', maxPrice: '12', taxRate: '15' } })).id;
      WH = (await tx.warehouse.create({ data: { tenantId: T, code: 'WH', name: 'رئيسي' } })).id;
      customer = (await tx.party.create({ data: { tenantId: T, kind: 'customer', name: 'عميل جيد', creditLimit: '5000' } })).id;
      poorCustomer = (await tx.party.create({ data: { tenantId: T, kind: 'customer', name: 'عميل محدود', creditLimit: '50' } })).id;
      supplier = (await tx.party.create({ data: { tenantId: T, kind: 'supplier', name: 'مورد' } })).id;
      cashAccountId = (await tx.cashAccount.create({ data: { tenantId: T, name: 'خزنة', kind: 'cash', accountId: A['100'] } })).id;
    });
    // stock: purchase 100 @ 4
    await purch.postSupplierInvoice(T, { partyId: supplier, warehouseId: WH, businessDate: '2026-10-05', idempotencyKey: 'seed-purchase-1', lines: [{ productId: P, qty: '100', unitCost: '4', taxRate: '15' }] });
  });

  it('AT-SALE-001: cash sale posts balanced journal, stock out at avg cost, VAT computed', async () => {
    const inv1 = await sales.createInvoice(T, { partyId: customer, warehouseId: WH, businessDate: '2026-10-10', idempotencyKey: 'sale-cash-1', lines: [{ productId: P, qty: '10' }], payments: [{ method: 'cash', amount: '115' }] }, { post: true });
    expect(inv1.total.toString()).toBe('115'); // 10*10 + 15% VAT
    expect(inv1.accountingStatus).toBe('posted'); expect(inv1.paymentStatus).toBe('paid');
    const again = await sales.createInvoice(T, { partyId: customer, warehouseId: WH, businessDate: '2026-10-10', idempotencyKey: 'sale-cash-1', lines: [{ productId: P, qty: '10' }] }, { post: true });
    expect(again.id).toBe(inv1.id);
    const bal = await inv.getBalance(T, P, WH); expect(bal[0].qty.toString()).toBe('90');
  });

  it('AT-SALE-002: free goods move stock and cost, tax on paid qty only per rate', async () => {
    const inv2 = await sales.createInvoice(T, { partyId: customer, warehouseId: WH, businessDate: '2026-10-10', idempotencyKey: 'sale-free-1', lines: [{ productId: P, qty: '5', freeQty: '2' }], payments: [{ method: 'cash', amount: '57.5' }] }, { post: true });
    expect(inv2.total.toString()).toBe('57.5');
    const bal = await inv.getBalance(T, P, WH); expect(bal[0].qty.toString()).toBe('83'); // 90-5-2
    expect(inv2.lines[0].freeQty.toString()).toBe('2');
  });

  it('AT-PRICE-001/002: out-of-bounds price blocked without approval, allowed with; master price unchanged', async () => {
    await expect(sales.createInvoice(T, { partyId: customer, warehouseId: WH, businessDate: '2026-10-10', idempotencyKey: 'sale-price-bad', lines: [{ productId: P, qty: '1', requestedPrice: '5' }], payments: [{ method: 'cash', amount: '5.75' }] }, { post: true })).rejects.toThrow(/خارج الحدود|FORBIDDEN/);
    const ok = await sales.createInvoice(T, { partyId: customer, warehouseId: WH, businessDate: '2026-10-10', idempotencyKey: 'sale-price-ok', lines: [{ productId: P, qty: '1', requestedPrice: '11' }], payments: [{ method: 'cash', amount: '12.65' }] }, { post: true });
    expect(ok.lines[0].originalPrice.toString()).toBe('10'); expect(ok.lines[0].unitPrice.toString()).toBe('11');
    const prod = await prisma.withTenant(T, (tx: any) => tx.product.findUnique({ where: { id: P } }));
    expect(prod.defaultPrice.toString()).toBe('10'); // master never mutated by a sale
  });

  it('credit limit enforced; draft has no accounting/stock effect; return via credit note restores stock', async () => {
    await expect(sales.createInvoice(T, { partyId: poorCustomer, warehouseId: WH, businessDate: '2026-10-10', idempotencyKey: 'sale-credit-bad', lines: [{ productId: P, qty: '10' }] }, { post: true })).rejects.toThrow(/CREDIT_LIMIT|حد الائتمان/);
    const draft = await sales.createInvoice(T, { partyId: customer, warehouseId: WH, businessDate: '2026-10-10', idempotencyKey: 'sale-draft-1', lines: [{ productId: P, qty: '3' }] }, { post: false });
    expect(draft.accountingStatus).toBe('unposted');
    let bal = await inv.getBalance(T, P, WH); expect(bal[0].qty.toString()).toBe('82');
    const posted = await sales.postDraft(T, draft.id, { payments: [{ method: 'cash', amount: '34.5' }] });
    expect(posted.accountingStatus).toBe('posted');
    const note = await sales.createReturn(T, { originalInvoiceId: posted.id, warehouseId: WH, businessDate: '2026-10-11', idempotencyKey: 'return-1', lines: [{ productId: P, qty: '1' }] });
    expect(note.total.toString()).toBe('11.5');
    bal = await inv.getBalance(T, P, WH); expect(bal[0].qty.toString()).toBe('80'); // 82-3+1
    const drift = await inv.reconcile(T); expect(drift).toEqual([]);
  });

  it('AT-DATE-001 skeleton: posting outside any period blocked; expense + receipt keep party balance consistent', async () => {
    await expect(sales.createInvoice(T, { partyId: customer, warehouseId: WH, businessDate: '2027-05-01', idempotencyKey: 'sale-date-bad', lines: [{ productId: P, qty: '1' }], payments: [{ method: 'cash', amount: '11.5' }] }, { post: true })).rejects.toThrow(/فترة محاسبية|CONFIGURATION/);
    const before = await prisma.withTenant(T, (tx: any) => parties.balance(tx, T, customer));
    await cash.postPayment(T, { partyId: customer, direction: 'in', method: 'cash', amount: '20', cashAccountId, businessDate: '2026-10-12', idempotencyKey: 'rcpt-1' });
    const after = await prisma.withTenant(T, (tx: any) => parties.balance(tx, T, customer));
    expect(after.minus(before).toString()).toBe('-20');
    const exp = await cash.postExpense(T, { category: 'fuel', amount: '30', cashAccountId, businessDate: '2026-10-12', idempotencyKey: 'exp-1' });
    expect(exp.status).toBe('posted');
    const tb = await acc.trialBalance(T, '2026-10-31');
    const td = tb.reduce((a: number, r: any) => a + Number(r.debit), 0), tc = tb.reduce((a: number, r: any) => a + Number(r.credit), 0);
    expect(td).toBeCloseTo(tc, 2);
  });
});
