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
import { MasterDataService } from '../src/masterdata/masterdata.service';

const run = process.env.RUN_INTEGRATION === '1';
describe.skipIf(!run)('Phase12 professional ops: users, cash, returns (real Postgres)', () => {
  const prisma = new PrismaService();
  const auth = new AuthService(prisma, new AuditService(prisma));
  const acc = new AccountingService(prisma); const inv = new InventoryService(prisma);
  const parties = new PartiesService(prisma, acc);
  const sales = new SalesService(prisma, acc, inv, parties);
  const purch = new PurchasingService(prisma, acc, inv);
  const cash = new CashService(prisma, acc);
  const master = new MasterDataService(prisma);
  const slug = 'p12-' + Math.random().toString(36).slice(2, 8);
  let T = '', productId = '', warehouseId = '', customerId = '', supplierId = '', cashAccountId = '', saleId = '';

  beforeAll(async () => {
    const r = await auth.createTenantWithOwner({ tenantName: 'P12', slug, email: 'o@p12.test', password: 'Strong-Pass-123!', displayName: 'O' });
    T = r.tenantId;
    await master.createFiscalYear(T, { name: '2026', startDate: '2026-01-01', endDate: '2026-12-31' });
    const mk = (code: string, name: string, type: string) => master.createAccount(T, { code, name, type });
    const cashAcc = await mk('1000', 'الخزينة', 'asset'); const ar = await mk('1100', 'ذمم العملاء', 'asset');
    const invAcc = await mk('1200', 'المخزون', 'asset'); const ap = await mk('2000', 'ذمم الموردين', 'liability');
    const vat = await mk('2100', 'الضريبة', 'liability'); const rev = await mk('4000', 'إيرادات', 'revenue');
    const cogs = await mk('5000', 'تكلفة مبيعات', 'expense'); const gen = await mk('5100', 'مصروفات عامة', 'expense');
    for (const [p, a] of Object.entries({ CASH_ON_HAND: cashAcc.id, AR_CUSTOMER: ar.id, INVENTORY: invAcc.id, AP_SUPPLIER: ap.id, VAT_OUTPUT: vat.id, VAT_INPUT: vat.id, SALES_REVENUE: rev.id, COGS: cogs.id, FREE_GOODS_EXPENSE: gen.id, EXPENSE_GENERAL: gen.id })) await master.setMapping(T, p, a);
    await master.updateTenantTax(T, { vatRegistered: true, vatNumber: '300000000000003' });
    const unit = await master.createUnit(T, { code: 'pcs', name: 'حبة' });
    productId = (await master.createProduct(T, { sku: 'BREAD', nameAr: 'خبز', stockUnitId: unit.id, defaultPrice: '10', minPrice: '9', maxPrice: '12', taxRate: '15' })).id;
    warehouseId = (await master.createWarehouse(T, { code: 'WH', name: 'رئيسي' })).id;
    cashAccountId = (await master.createCashAccount(T, { name: 'خزينة', kind: 'cash', accountId: cashAcc.id })).id;
    customerId = (await parties.create(T, { kind: 'customer', name: 'عميل', creditLimit: '5000' })).id;
    supplierId = (await parties.create(T, { kind: 'supplier', name: 'مورد' })).id;
    await purch.postSupplierInvoice(T, { partyId: supplierId, warehouseId, businessDate: '2026-10-05', idempotencyKey: 'p12-purchase-1', lines: [{ productId, qty: '100', unitCost: '4', taxRate: '15' }] });
  });

  it('AT-PRO-001: create a staff user with a role; the user can actually log in', async () => {
    const u = await master.createUser(T, { email: 'acc@p12.test', password: 'Staff-Pass-123', displayName: 'محاسب', roleCode: 'ACCOUNTANT' });
    expect(u.role).toBe('ACCOUNTANT');
    const session = await auth.login(slug, 'acc@p12.test', 'Staff-Pass-123');
    expect(session.user.id).toBe(u.id);
    const roles = await master.listRoles(T);
    expect(roles.length).toBeGreaterThanOrEqual(8);
    expect((await master.listUsers(T)).length).toBe(2); // owner + accountant
  });

  it('AT-PRO-002: expense posts through the cash account and appears in the list', async () => {
    const e = await cash.postExpense(T, { category: 'إيجار', description: 'إيجار أكتوبر', amount: '500', cashAccountId, businessDate: '2026-10-06', idempotencyKey: 'p12-expense-1' });
    expect(e.id).toBeTruthy();
    expect((await master.listExpenses(T)).length).toBe(1);
  });

  it('AT-PRO-003: sale then partial return (credit note) restores stock', async () => {
    const sale = await sales.createInvoice(T, { partyId: customerId, warehouseId, businessDate: '2026-10-10', idempotencyKey: 'p12-sale-1', lines: [{ productId, qty: '10' }], payments: [{ method: 'cash', amount: '115' }] }, { post: true });
    saleId = sale.id;
    expect((await master.listInvoices(T))[0].lines.length).toBe(1); // invoice detail for printing
    const note = await sales.createReturn(T, { originalInvoiceId: saleId, warehouseId, businessDate: '2026-10-11', idempotencyKey: 'p12-return-1', lines: [{ productId, qty: '2' }], createdBy: undefined as never });
    expect(note.id).toBeTruthy();
    const bal = await inv.getBalance(T, productId, warehouseId);
    expect(bal[0].qty.toString()).toBe('92'); // 100 - 10 + 2
    const tb = (await acc.trialBalance(T, '2026-10-31')) as any[];
    expect(tb.reduce((a, r) => a + Number(r.debit), 0) - tb.reduce((a, r) => a + Number(r.credit), 0)).toBe(0);
  });
});
