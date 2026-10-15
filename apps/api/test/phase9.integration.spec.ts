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
import { AiService } from '../src/ai/ai.service';

const run = process.env.RUN_INTEGRATION === '1';
// Fake provider at the adapter boundary: echoes a phrasing, records what it was sent.
class FakeProvider { sent: any[] = []; async complete(input: any) { this.sent.push(input); return 'إجابة مُصاغة من بيانات الأدوات'; } }
describe.skipIf(!run)('Phase9 AI assistant (AT-AI-001)', () => {
  const prisma = new PrismaService();
  const auth = new AuthService(prisma, new AuditService(prisma));
  const acc = new AccountingService(prisma); const inv = new InventoryService(prisma);
  const parties = new PartiesService(prisma, acc);
  const sales = new SalesService(prisma, acc, inv, parties);
  const purch = new PurchasingService(prisma, acc, inv);
  const reports = new ReportingService(prisma, acc, inv);
  const fake = new FakeProvider();
  const ai = new AiService(prisma, reports, fake as never);
  const slug = 'p9-' + Math.random().toString(36).slice(2, 8);
  let T = ''; let ownerId = '';

  beforeAll(async () => {
    const r = await auth.createTenantWithOwner({ tenantName: 'P9', slug, email: 'o@p9.test', password: 'Strong-Pass-123!', displayName: 'O' });
    T = r.tenantId; ownerId = r.userId;
    let WH = '', P = '', customer = '', supplier = '';
    await prisma.withTenant(T, async (tx: any) => {
      const mk = async (code: string, type: string) => (await tx.account.create({ data: { tenantId: T, code, name: code, type } })).id;
      const A: Record<string, string> = {};
      for (const [c, t] of [['100','asset'],['110','asset'],['120','asset'],['200','liability'],['400','revenue'],['500','expense']] as const) A[c] = await mk(c, t);
      const map: Record<string, string> = { CASH_ON_HAND: A['100'], AR_CUSTOMER: A['110'], INVENTORY: A['120'], AP_SUPPLIER: A['200'], SALES_REVENUE: A['400'], COGS: A['500'], FREE_GOODS_EXPENSE: A['500'], VAT_OUTPUT: A['200'], VAT_INPUT: A['200'] };
      for (const [purpose, accountId] of Object.entries(map)) await tx.accountMapping.create({ data: { tenantId: T, purpose, accountId } });
      const fy = await tx.fiscalYear.create({ data: { tenantId: T, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
      await tx.accountingPeriod.create({ data: { tenantId: T, fiscalYearId: fy.id, name: '2026-10', startDate: new Date('2026-10-01'), endDate: new Date('2026-10-31') } });
      const unit = await tx.unitOfMeasure.create({ data: { tenantId: T, code: 'pcs', name: 'حبة' } });
      P = (await tx.product.create({ data: { tenantId: T, sku: 'BREAD', nameAr: 'خبز', stockUnitId: unit.id, defaultPrice: '10' } })).id;
      WH = (await tx.warehouse.create({ data: { tenantId: T, code: 'WH', name: 'رئيسي' } })).id;
      customer = (await tx.party.create({ data: { tenantId: T, kind: 'customer', name: 'عميل', creditLimit: '10000' } })).id;
      supplier = (await tx.party.create({ data: { tenantId: T, kind: 'supplier', name: 'مورد' } })).id;
    });
    await purch.postSupplierInvoice(T, { partyId: supplier, warehouseId: WH, businessDate: '2026-10-01', idempotencyKey: 'p9-buy', lines: [{ productId: P, qty: '100', unitCost: '4' }] });
    await sales.createInvoice(T, { partyId: customer, warehouseId: WH, businessDate: '2026-10-05', idempotencyKey: 'p9-sale', lines: [{ productId: P, qty: '10' }], payments: [{ method: 'cash', amount: '100' }] }, { post: true });
  });

  const ownerCtx = () => ({ userId: ownerId, permissions: ['ai.use', 'reports.view', 'parties.view', 'inventory.view', 'settlement.view', 'tenant.configure'] });

  it('answers sales question from reports (structured mode, no provider configured)', async () => {
    const r = await ai.ask(T, ownerCtx(), 'ما هي مبيعات هذا الشهر؟');
    expect(r.tool).toBe('sales_summary');
    expect((r.data as any).totalNet).toBe('100');
    const calls = await prisma.withTenant(T, (tx: any) => tx.aiToolCall.findMany({ where: { tenantId: T } }));
    expect(calls.length).toBeGreaterThan(0); expect(calls[0].status).toBe('executed'); // fully audited
  });

  it('tool permission enforced server-side: user without reports.view is denied and denial is audited', async () => {
    await expect(ai.ask(T, { userId: ownerId, permissions: ['ai.use'] }, 'ما هي مبيعات اليوم؟')).rejects.toThrow(/reports.view|صلاحية/);
    const denied = await prisma.withTenant(T, (tx: any) => tx.aiToolCall.findFirst({ where: { tenantId: T, status: 'denied' } }));
    expect(denied).toBeTruthy();
    await expect(ai.ask(T, { userId: ownerId, permissions: [] }, 'مبيعات')).rejects.toThrow(/ai.use/);
  });

  it('provider phrasing is optional and receives only tool data + system guardrails', async () => {
    await ai.configure(T, { provider: 'fake-compatible', baseUrl: 'https://example.invalid/v1', model: 'fake-1', secretRef: 'AI_TEST_KEY', isEnabled: true });
    process.env.AI_TEST_KEY = 'test-key-not-real';
    // Swap adapter internals: our fake implements the same complete() contract via provider injection point
    (ai as any).provider = fake;
    const r = await ai.ask(T, ownerCtx(), 'لخص قائمة الدخل');
    expect(fake.sent.length).toBe(1);
    expect(fake.sent[0].system).toContain('never invent figures');
    expect(r.answer).toContain('مُصاغة');
    delete process.env.AI_TEST_KEY;
  });

  it('sensitive action becomes a pending human approval and executes NOTHING', async () => {
    const before = await prisma.withTenant(T, (tx: any) => tx.journalEntry.count({ where: { tenantId: T } }));
    const r = await ai.ask(T, ownerCtx(), 'أرسل تذكير تحصيل للعملاء');
    expect((r.data as any).requiresApproval).toBe(true);
    const after = await prisma.withTenant(T, (tx: any) => tx.journalEntry.count({ where: { tenantId: T } }));
    expect(after).toBe(before);
    const decided = await ai.decideApproval(T, ownerCtx(), (r.data as any).toolCallId, 'rejected');
    expect(decided.status).toBe('rejected');
  });

  it('tenant isolation: another tenant sees none of this data', async () => {
    const other = await auth.createTenantWithOwner({ tenantName: 'Other', slug: slug + 'x', email: 'x@other.test', password: 'Strong-Pass-123!', displayName: 'X' });
    const r = await ai.ask(other.tenantId, { userId: other.userId, permissions: ownerCtx().permissions }, 'ما هي مبيعات هذا الشهر؟');
    expect((r.data as any).totalNet).toBe('0');
  });
});
