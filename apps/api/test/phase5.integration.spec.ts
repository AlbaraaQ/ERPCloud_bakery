import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { AccountingService } from '../src/accounting/accounting.service';
import { InventoryService, StockCountsService } from '../src/inventory/inventory.service';
import { PartiesService } from '../src/parties/parties.service';
import { PurchasingService } from '../src/purchasing/purchasing.service';
import { ManufacturingService } from '../src/manufacturing/manufacturing.service';

const run = process.env.RUN_INTEGRATION === '1';
describe.skipIf(!run)('Phase5 manufacturing (real Postgres)', () => {
  const prisma = new PrismaService();
  const auth = new AuthService(prisma, new AuditService(prisma));
  const acc = new AccountingService(prisma); const inv = new InventoryService(prisma);
  const parties = new PartiesService(prisma, acc);
  const purch = new PurchasingService(prisma, acc, inv);
  const mfg = new ManufacturingService(prisma, acc, inv);
  const counts = new StockCountsService(prisma, acc, inv);
  void parties;
  const slug = 'p5-' + Math.random().toString(36).slice(2, 8);
  let T = '', WH = '', FLOUR = '', SUGAR = '', BREAD = '', supplier = '', bomId = '';

  beforeAll(async () => {
    const r = await auth.createTenantWithOwner({ tenantName: 'P5', slug, email: 'o@p5.test', password: 'Strong-Pass-123!', displayName: 'O' });
    T = r.tenantId;
    await prisma.withTenant(T, async (tx: any) => {
      const mk = async (code: string, type: string) => (await tx.account.create({ data: { tenantId: T, code, name: code, type } })).id;
      const A: Record<string, string> = {};
      for (const [c, t] of [['120','asset'],['200','liability'],['500','expense'],['400','revenue'],['210','liability'],['300','liability']] as const) A[c] = await mk(c, t);
      const map: Record<string, string> = { INVENTORY: A['120'], AP_SUPPLIER: A['200'], COGS: A['500'], SCRAP_LOSS: A['500'], SHORTAGE_LOSS: A['500'], SHORTAGE_GAIN: A['400'], SALES_REVENUE: A['400'], PRODUCTION_LABOUR: A['300'], VAT_INPUT: A['210'], VAT_OUTPUT: A['210'] };
      for (const [purpose, accountId] of Object.entries(map)) await tx.accountMapping.create({ data: { tenantId: T, purpose, accountId } });
      const fy = await tx.fiscalYear.create({ data: { tenantId: T, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
      await tx.accountingPeriod.create({ data: { tenantId: T, fiscalYearId: fy.id, name: '2026-10', startDate: new Date('2026-10-01'), endDate: new Date('2026-10-31') } });
      const unit = await tx.unitOfMeasure.create({ data: { tenantId: T, code: 'kg', name: 'كجم' } });
      const pcs = await tx.unitOfMeasure.create({ data: { tenantId: T, code: 'pcs', name: 'حبة' } });
      FLOUR = (await tx.product.create({ data: { tenantId: T, sku: 'FLOUR', nameAr: 'دقيق', stockUnitId: unit.id } })).id;
      SUGAR = (await tx.product.create({ data: { tenantId: T, sku: 'SUGAR', nameAr: 'سكر', stockUnitId: unit.id } })).id;
      BREAD = (await tx.product.create({ data: { tenantId: T, sku: 'BREAD', nameAr: 'خبز', stockUnitId: pcs.id, lotTracked: true, defaultPrice: '5' } })).id;
      WH = (await tx.warehouse.create({ data: { tenantId: T, code: 'WH', name: 'رئيسي' } })).id;
      supplier = (await tx.party.create({ data: { tenantId: T, kind: 'supplier', name: 'مورد' } })).id;
    });
    await purch.postSupplierInvoice(T, { partyId: supplier, warehouseId: WH, businessDate: '2026-10-01', idempotencyKey: 'p5-buy-1', lines: [{ productId: FLOUR, qty: '100', unitCost: '2' }, { productId: SUGAR, qty: '50', unitCost: '3' }] });
    const bom = await mfg.createBom(T, { productId: BREAD, name: 'وصفة خبز', lines: [{ ingredientProductId: FLOUR, qtyPerUnit: '0.5' }, { ingredientProductId: SUGAR, qtyPerUnit: '0.1' }] });
    bomId = bom.id;
  });

  it('AT-MFG-002: missing cost-component mapping blocks completion and posts nothing', async () => {
    const o = await mfg.createOrder(T, { bomId, warehouseId: WH, plannedQty: '10', businessDate: '2026-10-02', idempotencyKey: 'ord-blocked' });
    await expect(mfg.complete(T, { orderId: o.id, businessDate: '2026-10-02', goodQty: '10', consumption: [{ productId: FLOUR, actualQty: '5' }], components: [{ kind: 'overhead', amount: '20' }] })).rejects.toThrow(/PRODUCTION_OVERHEAD|غير مُكوَّن/);
    const after = await prisma.withTenant(T, (tx: any) => tx.productionOrder.findUnique({ where: { id: o.id } }));
    expect(after.status).toBe('planned');
  });

  it('AT-MFG-001: full costing with labour, abnormal scrap expensed, lot genealogy, variance', async () => {
    // flour lot for traceability
    const lot = await prisma.withTenant(T, async (tx: any) => tx.lot.create({ data: { tenantId: T, productId: FLOUR, code: 'FL-2026-01', expiryDate: new Date('2027-01-01') } }));
    await inv.postMovement(T, { productId: FLOUR, warehouseId: WH, lotId: lot.id, type: 'opening', qty: '60', unitCost: '2', sourceType: 'test', sourceId: 'lot-in', idempotencyKey: 'p5-lot-in', businessDate: '2026-10-01' });
    const o = await mfg.createOrder(T, { bomId, warehouseId: WH, plannedQty: '100', businessDate: '2026-10-03', idempotencyKey: 'ord-1' });
    const done = await mfg.complete(T, { orderId: o.id, businessDate: '2026-10-03', goodQty: '95', abnormalScrapQty: '5', scrapReason: 'احتراق', finishedLotCode: 'BR-001', finishedExpiry: '2026-10-20', consumption: [{ productId: FLOUR, actualQty: '52', lotId: lot.id }, { productId: SUGAR, actualQty: '10' }], components: [{ kind: 'labour', amount: '100' }] });
    // material = 52*2 + 10*3 = 134; + labour 100 = 234; produced 100 -> 2.34/unit; scrap 5*2.34=11.7 expensed; finished 95 @ 2.34
    expect(done.totalCost.toString()).toBe('234'); expect(done.unitCost.toString()).toBe('2.34');
    expect(done.status).toBe('completed');
    const again = await mfg.complete(T, { orderId: o.id, businessDate: '2026-10-03', goodQty: '95', consumption: [{ productId: FLOUR, actualQty: '52' }] });
    expect(again.id).toBe(done.id); // idempotent completion
    const bread = await inv.getBalance(T, BREAD, WH); expect(bread[0].qty.toString()).toBe('95');
    const scrap = await prisma.withTenant(T, (tx: any) => tx.scrapRecord.findFirst({ where: { tenantId: T, orderId: o.id } }));
    expect(scrap.amount.toString()).toBe('11.7'); expect(scrap.kind).toBe('abnormal');
    const trace = await mfg.trace(T, { finishedLotId: done.finishedLotId });
    expect(trace).toHaveLength(1); expect(trace[0].rawLotId).toBe(lot.id);
    const variance = await mfg.variance(T, o.id);
    const flourV = variance.find((v: any) => v.productId === FLOUR); expect(flourV.planned).toBe('50'); expect(flourV.actual).toBe('52'); expect(flourV.variance).toBe('2');
    const tb = await acc.trialBalance(T, '2026-10-31');
    const td = tb.reduce((a: number, r: any) => a + Number(r.debit), 0), tc = tb.reduce((a: number, r: any) => a + Number(r.credit), 0);
    expect(td).toBeCloseTo(tc, 2);
    const drift = await inv.reconcile(T); expect(drift).toEqual([]);
  });

  it('stock count: approved variance posts adjustment, FEFO suggests earliest expiry', async () => {
    const before = await inv.getBalance(T, SUGAR, WH); // 50-10=40
    expect(before[0].qty.toString()).toBe('40');
    const c = await counts.postCount(T, { warehouseId: WH, businessDate: '2026-10-10', lines: [{ productId: SUGAR, countedQty: '38', reason: 'تلف' }] });
    expect(c.status).toBe('posted');
    const after = await inv.getBalance(T, SUGAR, WH); expect(after[0].qty.toString()).toBe('38');
    const suggestions = await counts.fefo(T, FLOUR, WH);
    expect(suggestions[0].expiryDate).toBeTruthy();
  });
});
