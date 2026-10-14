import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { AccountingService } from '../src/accounting/accounting.service';
import { InventoryService } from '../src/inventory/inventory.service';
import { PartiesService } from '../src/parties/parties.service';
import { SalesService } from '../src/sales/sales.service';
import { PurchasingService } from '../src/purchasing/purchasing.service';
import { RepresentativesService } from '../src/representatives/representatives.service';
import { TransfersService } from '../src/transfers/transfers.service';
import { SettlementsService } from '../src/settlements/settlements.service';
import { SyncService } from '../src/sync/sync.service';
import { NotificationsService } from '../src/notifications/notifications.service';

const run = process.env.RUN_INTEGRATION === '1';
describe.skipIf(!run)('Phase4 representatives/transfers/sync/settlement (real Postgres)', () => {
  const prisma = new PrismaService();
  const auth = new AuthService(prisma, new AuditService(prisma));
  const acc = new AccountingService(prisma); const inv = new InventoryService(prisma);
  const parties = new PartiesService(prisma, acc);
  const sales = new SalesService(prisma, acc, inv, parties);
  const purch = new PurchasingService(prisma, acc, inv);
  const notif = new NotificationsService(prisma);
  const reps = new RepresentativesService(prisma, notif);
  const transfers = new TransfersService(prisma, acc, inv, reps, notif);
  const settlements = new SettlementsService(prisma, acc, inv, notif);
  const sync = new SyncService(prisma, sales);
  const slug = 'p4-' + Math.random().toString(36).slice(2, 8);
  let T = '', WH = '', P = '', customer = '', supplier = '', employee = '', repUser = '', repWh = '';

  beforeAll(async () => {
    const r = await auth.createTenantWithOwner({ tenantName: 'P4', slug, email: 'o@p4.test', password: 'Strong-Pass-123!', displayName: 'O' });
    T = r.tenantId;
    await prisma.withTenant(T, async (tx: any) => {
      const mk = async (code: string, type: string) => (await tx.account.create({ data: { tenantId: T, code, name: code, type } })).id;
      const A: Record<string, string> = {};
      for (const [c, t] of [['100','asset'],['110','asset'],['120','asset'],['200','liability'],['400','revenue'],['500','expense'],['510','expense'],['520','expense'],['130','asset']] as const) A[c] = await mk(c, t);
      const map: Record<string, string> = { CASH_ON_HAND: A['100'], AR_CUSTOMER: A['110'], INVENTORY: A['120'], AP_SUPPLIER: A['200'], SALES_REVENUE: A['400'], COGS: A['500'], FREE_GOODS_EXPENSE: A['500'], EXPENSE_GENERAL: A['510'], SHORTAGE_LOSS: A['510'], SHORTAGE_GAIN: A['400'], EMPLOYEE_RECEIVABLE: A['130'], VAT_OUTPUT: A['200'], VAT_INPUT: A['200'] };
      for (const [purpose, accountId] of Object.entries(map)) await tx.accountMapping.create({ data: { tenantId: T, purpose, accountId } });
      const fy = await tx.fiscalYear.create({ data: { tenantId: T, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
      await tx.accountingPeriod.create({ data: { tenantId: T, fiscalYearId: fy.id, name: '2026-10', startDate: new Date('2026-10-01'), endDate: new Date('2026-10-31') } });
      const unit = await tx.unitOfMeasure.create({ data: { tenantId: T, code: 'pcs', name: 'حبة' } });
      P = (await tx.product.create({ data: { tenantId: T, sku: 'BREAD', nameAr: 'خبز', stockUnitId: unit.id, defaultPrice: '10' } })).id;
      WH = (await tx.warehouse.create({ data: { tenantId: T, code: 'MAIN', name: 'رئيسي' } })).id;
      customer = (await tx.party.create({ data: { tenantId: T, kind: 'customer', name: 'عميل', creditLimit: '10000' } })).id;
      supplier = (await tx.party.create({ data: { tenantId: T, kind: 'supplier', name: 'مورد' } })).id;
      employee = (await tx.employee.create({ data: { tenantId: T, fullName: 'مندوب أحمد' } })).id;
      repUser = (await tx.user.create({ data: { tenantId: T, email: 'rep@p4.test', passwordHash: 'x', displayName: 'أحمد', employeeId: employee } })).id;
    });
    await purch.postSupplierInvoice(T, { partyId: supplier, warehouseId: WH, businessDate: '2026-10-01', idempotencyKey: 'p4-buy-1', lines: [{ productId: P, qty: '200', unitCost: '4' }] });
  });

  it('AT-REP-001: assign role twice -> exactly one rep warehouse', async () => {
    const a = await reps.assign(T, { employeeId: employee, userId: repUser });
    const b = await reps.assign(T, { employeeId: employee, userId: repUser });
    expect(b.id).toBe(a.id); repWh = a.warehouseId;
    const whs = await prisma.withTenant(T, (tx: any) => tx.warehouse.findMany({ where: { tenantId: T, employeeId: employee } }));
    expect(whs).toHaveLength(1);
  });

  it('AT-TRF: dispatch notifies, partial accept + dispute, double receive blocked, shortage approved', async () => {
    const tr = await transfers.dispatch(T, { fromWarehouseId: WH, toWarehouseId: repWh, businessDate: '2026-10-02', idempotencyKey: 'tr-1', lines: [{ productId: P, qty: '50' }] });
    const notifs = await notif.list(T, repUser); expect(notifs.length).toBeGreaterThan(0);
    let repBal = await inv.getBalance(T, P, repWh); expect(repBal[0]?.qty.toString() ?? '0').toBe('0'); // custody sellable only after acceptance
    const rec = await transfers.receive(T, { transferId: tr.id, businessDate: '2026-10-02', lines: [{ productId: P, acceptedQty: '45', disputedQty: '5', disputeReason: 'نقص بالطريق' }] });
    expect(rec.status).toBe('disputed');
    repBal = await inv.getBalance(T, P, repWh); expect(repBal[0].qty.toString()).toBe('45');
    await expect(transfers.receive(T, { transferId: tr.id, businessDate: '2026-10-02', lines: [{ productId: P, acceptedQty: '10' }] })).rejects.toThrow(/OVER_RECEIPT|أكبر/);
    const closed = await transfers.resolveDispute(T, { transferId: tr.id, productId: P, action: 'approve_shortage', businessDate: '2026-10-03' });
    expect(closed.status).toBe('closed');
  });

  it('AT-OFF-001/002: offline sale syncs once; duplicate push same result; tampered payload conflicts; oversell rejected', async () => {
    const op = { clientOpId: 'device-op-0001', type: 'sales_invoice', payload: { partyId: customer, warehouseId: repWh, representativeId: employee, businessDate: '2026-10-05', lines: [{ productId: P, qty: '5' }], payments: [{ method: 'cash', amount: '50' }] } };
    const r1 = await sync.push(T, { userId: repUser }, [op]); expect(r1[0].status).toBe('applied');
    const r2 = await sync.push(T, { userId: repUser }, [op]); expect(r2[0].status).toBe('applied'); expect(r2[0].resultDocumentId).toBe(r1[0].resultDocumentId);
    const tampered = { ...op, payload: { ...op.payload, lines: [{ productId: P, qty: '99' }] } };
    const r3 = await sync.push(T, { userId: repUser }, [tampered]); expect(r3[0].status).toBe('conflict');
    const over = { clientOpId: 'device-op-0002', type: 'sales_invoice', payload: { partyId: customer, warehouseId: repWh, representativeId: employee, businessDate: '2026-10-05', lines: [{ productId: P, qty: '9999' }], payments: [] } };
    const r4 = await sync.push(T, { userId: repUser }, [over]); expect(r4[0].status).toBe('rejected');
    const bal = await inv.getBalance(T, P, repWh); expect(bal[0].qty.toString()).toBe('40'); // 45-5 only
    const drift = await inv.reconcile(T); expect(drift).toEqual([]);
  });

  it('AT-SET-001/002: normal settlement finalizes; with shortage it blocks, exception blocks debt until explicit approval', async () => {
    const s1 = await settlements.request(T, { employeeId: employee, periodStart: '2026-10-01', periodEnd: '2026-10-31' });
    expect(s1.expectedCash.toString()).toBe('50');
    const lines = await prisma.withTenant(T, (tx: any) => tx.settlementLine.findMany({ where: { settlementId: s1.id } }));
    const counted = lines.map((l: any) => ({ productId: l.productId, qty: l.expectedQty.toString() }));
    const fin = await settlements.finalize(T, { settlementId: s1.id, counted, countedCash: '50', cashHandedOver: '50', businessDate: '2026-10-31' });
    expect(fin.finalized, JSON.stringify(fin).slice(0,400)).toBe(true);
    const s2 = await settlements.request(T, { employeeId: employee, periodStart: '2026-10-01', periodEnd: '2026-10-31' });
    const shortCounted = counted.map((c: any) => ({ ...c, qty: '38' })); // 2 missing vs expected 40
    const blocked = await settlements.finalize(T, { settlementId: s2.id, counted: shortCounted, countedCash: '50', cashHandedOver: '50', businessDate: '2026-10-31' });
    expect(blocked.finalized).toBe(false);
    const exs = await prisma.withTenant(T, (tx: any) => tx.settlementException.findMany({ where: { settlementId: s2.id, status: 'under_investigation' } }));
    expect(exs.length).toBeGreaterThan(0);
    // no employee receivable journal exists yet — shortage did NOT become debt automatically
    const debtJournals = await prisma.withTenant(T, async (tx: any) => tx.journalEntry.count({ where: { tenantId: T, sourceType: 'settlement_exception' } }));
    expect(debtJournals).toBe(0);
    const decided = await settlements.decideException(T, { exceptionId: exs[0].id, decision: 'adjustment', reason: 'عجز موثق بمحضر عدّ', businessDate: '2026-10-31' });
    expect(decided.status).toBe('approved_adjustment');
    const bal = await inv.getBalance(T, P, repWh); expect(bal[0].qty.toString()).toBe('38');
    const fin2 = await settlements.finalize(T, { settlementId: s2.id, counted: [{ productId: P, qty: '38' }], countedCash: '50', cashHandedOver: '50', businessDate: '2026-10-31' });
    expect(fin2.finalized, JSON.stringify(fin2).slice(0,400)).toBe(true);
  });
});
