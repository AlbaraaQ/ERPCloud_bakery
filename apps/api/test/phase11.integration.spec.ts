import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { AccountingService } from '../src/accounting/accounting.service';
import { InventoryService } from '../src/inventory/inventory.service';
import { PartiesService } from '../src/parties/parties.service';
import { SalesService } from '../src/sales/sales.service';
import { PurchasingService } from '../src/purchasing/purchasing.service';
import { MasterDataService } from '../src/masterdata/masterdata.service';

const run = process.env.RUN_INTEGRATION === '1';
describe.skipIf(!run)('Phase11 master-data setup path -> real sale (real Postgres)', () => {
  const prisma = new PrismaService();
  const auth = new AuthService(prisma, new AuditService(prisma));
  const acc = new AccountingService(prisma); const inv = new InventoryService(prisma);
  const parties = new PartiesService(prisma, acc);
  const sales = new SalesService(prisma, acc, inv, parties);
  const purch = new PurchasingService(prisma, acc, inv);
  const master = new MasterDataService(prisma);
  const slug = 'p11-' + Math.random().toString(36).slice(2, 8);
  let T = '', productId = '', warehouseId = '', customerId = '', supplierId = '';

  beforeAll(async () => {
    const r = await auth.createTenantWithOwner({ tenantName: 'P11', slug, email: 'o@p11.test', password: 'Strong-Pass-123!', displayName: 'O' });
    T = r.tenantId;
    // Everything below is EXACTLY what the web setup wizard calls (no raw SQL seeding).
    await master.createFiscalYear(T, { name: '2026', startDate: '2026-01-01', endDate: '2026-12-31' });
    const mk = (code: string, name: string, type: string) => master.createAccount(T, { code, name, type });
    const cash = await mk('1000', 'الخزينة', 'asset'); const ar = await mk('1100', 'ذمم العملاء', 'asset');
    const invAcc = await mk('1200', 'المخزون', 'asset'); const ap = await mk('2000', 'ذمم الموردين', 'liability');
    const vat = await mk('2100', 'ضريبة القيمة المضافة', 'liability'); const rev = await mk('4000', 'إيرادات المبيعات', 'revenue');
    const cogs = await mk('5000', 'تكلفة المبيعات', 'expense'); const free = await mk('5100', 'بضاعة مجانية', 'expense');
    await master.setMapping(T, 'CASH_ON_HAND', cash.id); await master.setMapping(T, 'AR_CUSTOMER', ar.id);
    await master.setMapping(T, 'INVENTORY', invAcc.id); await master.setMapping(T, 'AP_SUPPLIER', ap.id);
    await master.setMapping(T, 'VAT_OUTPUT', vat.id); await master.setMapping(T, 'VAT_INPUT', vat.id);
    await master.setMapping(T, 'SALES_REVENUE', rev.id); await master.setMapping(T, 'COGS', cogs.id);
    await master.setMapping(T, 'FREE_GOODS_EXPENSE', free.id); await master.setMapping(T, 'EXPENSE_GENERAL', free.id);
    await master.updateTenantTax(T, { vatRegistered: true, vatNumber: '300000000000003' });
    const unit = await master.createUnit(T, { code: 'pcs', name: 'حبة' });
    const prod = await master.createProduct(T, { sku: 'BREAD', nameAr: 'خبز', stockUnitId: unit.id, defaultPrice: '10', minPrice: '9', maxPrice: '12', taxRate: '15' });
    productId = prod.id;
    warehouseId = (await master.createWarehouse(T, { code: 'WH', name: 'الرئيسي' })).id;
    await master.createCashAccount(T, { name: 'الخزينة الرئيسية', kind: 'cash', accountId: cash.id });
    customerId = (await parties.create(T, { kind: 'customer', name: 'عميل', creditLimit: '5000' })).id;
    supplierId = (await parties.create(T, { kind: 'supplier', name: 'مورد' })).id;
  });

  it('AT-UI-001: lists used by the web UI return the created master data', async () => {
    expect((await master.listProducts(T)).length).toBe(1);
    expect((await master.listAccounts(T)).length).toBe(8);
    expect((await master.listMappings(T)).length).toBe(10);
    const fys = await master.listFiscalYears(T);
    expect(fys[0].periods.length).toBe(12);
  });

  it('AT-UI-002: purchase -> sale -> balanced journals, all driven by master data', async () => {
    await purch.postSupplierInvoice(T, { partyId: supplierId, warehouseId, businessDate: '2026-10-05', idempotencyKey: 'p11-purchase-1', lines: [{ productId, qty: '100', unitCost: '4', taxRate: '15' }] });
    const sale = await sales.createInvoice(T, { partyId: customerId, warehouseId, businessDate: '2026-10-10', idempotencyKey: 'p11-sale-1', lines: [{ productId, qty: '10' }], payments: [{ method: 'cash', amount: '115' }] }, { post: true });
    expect(sale.total.toString()).toBe('115');
    expect((await master.listInvoices(T)).length).toBe(1);
    expect((await master.listStockBalances(T))[0].qty.toString()).toBe('90');
    const tb = await acc.trialBalance(T, '2026-10-31');
    const diff = (tb as any).difference ?? (tb as any).totalDebit - (tb as any).totalCredit;
    expect(Number(diff)).toBe(0);
  });
});
