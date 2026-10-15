import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { AccountingService } from '../src/accounting/accounting.service';
import { InventoryService } from '../src/inventory/inventory.service';
import { PartiesService } from '../src/parties/parties.service';
import { SalesService } from '../src/sales/sales.service';
import { PurchasingService } from '../src/purchasing/purchasing.service';
import { ReportingService } from '../src/reporting/reporting.service';

const run = process.env.RUN_INTEGRATION === '1';
describe.skipIf(!run)('Phase7 reporting (AT-RPT-001, real Postgres)', () => {
  const prisma = new PrismaService();
  const auth = new AuthService(prisma, new AuditService(prisma));
  const acc = new AccountingService(prisma); const inv = new InventoryService(prisma);
  const parties = new PartiesService(prisma, acc);
  const sales = new SalesService(prisma, acc, inv, parties);
  const purch = new PurchasingService(prisma, acc, inv);
  const reports = new ReportingService(prisma, acc, inv);
  const slug = 'p7-' + Math.random().toString(36).slice(2, 8);
  let T = '';

  beforeAll(async () => {
    const r = await auth.createTenantWithOwner({ tenantName: 'P7', slug, email: 'o@p7.test', password: 'Strong-Pass-123!', displayName: 'O' });
    T = r.tenantId;
    let WH = '', P = '', customer = '', supplier = '';
    await prisma.withTenant(T, async (tx: any) => {
      await tx.tenant.update({ where: { id: T }, data: { vatRegistered: true, vatNumber: '300000000000003' } });
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
      customer = (await tx.party.create({ data: { tenantId: T, kind: 'customer', name: 'عميل', creditLimit: '10000', paymentTermsDays: 30 } })).id;
      supplier = (await tx.party.create({ data: { tenantId: T, kind: 'supplier', name: 'مورد' } })).id;
    });
    await purch.postSupplierInvoice(T, { partyId: supplier, warehouseId: WH, businessDate: '2026-10-01', idempotencyKey: 'p7-buy', lines: [{ productId: P, qty: '100', unitCost: '4', taxRate: '15' }] });
    // cash sale 10 (115) + credit sale 20 (230, unpaid)
    await sales.createInvoice(T, { partyId: customer, warehouseId: WH, businessDate: '2026-10-05', idempotencyKey: 'p7-sale-cash', lines: [{ productId: P, qty: '10' }], payments: [{ method: 'cash', amount: '115' }] }, { post: true });
    await sales.createInvoice(T, { partyId: customer, warehouseId: WH, businessDate: '2026-10-05', idempotencyKey: 'p7-sale-credit', lines: [{ productId: P, qty: '20' }] }, { post: true });
  });

  it('income statement, balance sheet balance, aging, valuation vs GL all reconcile', async () => {
    const is = await reports.incomeStatement(T, '2026-10-01', '2026-10-31');
    expect(is.revenue).toBe('300'); // 100+200 net
    expect(is.expenses).toBe('120'); // COGS 30 units * 4
    expect(is.netProfit).toBe('180');
    const bs = await reports.balanceSheet(T, '2026-10-31');
    expect(bs.balanced).toBe(true);
    const aging = await reports.aging(T, 'customer', '2026-10-20');
    expect(aging.buckets.current).toBe('230'); // credit sale due in 30d
    const apAging = await reports.aging(T, 'supplier', '2026-10-20');
    expect(apAging.buckets.current).toBe('460'); // 400 + 60 VAT
    const rec = await reports.reconciliations(T, '2026-10-31');
    expect(rec.trialBalanceDifference).toBe('0');
    expect(rec.stockLedgerDriftRows).toBe(0);
    expect(rec.inventoryDifference).toBe('0'); // valuation 70*4=280 == GL inventory
    expect(rec.inventoryValuation).toBe('280');
    const ledger = await reports.generalLedger(T, '400', '2026-10-01', '2026-10-31');
    expect(ledger.length).toBeGreaterThan(0);
    const dashboard = await reports.dashboard(T);
    expect(dashboard.openSettlements).toBe(0);
    const salesR = await reports.salesReport(T, '2026-10-01', '2026-10-31', 'product');
    expect(salesR[0].qty).toBe('30'); expect(salesR[0].grossProfit).toBe('180');
  });
});
