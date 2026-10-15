import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { AccountingService } from '../src/accounting/accounting.service';
import { InventoryService } from '../src/inventory/inventory.service';

const run = process.env.RUN_INTEGRATION === '1';
describe.skipIf(!run)('Phase2 accounting+inventory (real Postgres)', () => {
  const prisma = new PrismaService();
  const auth = new AuthService(prisma, new AuditService(prisma));
  const acc = new AccountingService(prisma);
  const inv = new InventoryService(prisma);
  const slug = 'p2-' + Math.random().toString(36).slice(2, 8);
  let T = ''; let cash = ''; let rev = ''; let invAcc = ''; let cogs = '';
  let product = ''; let warehouse = '';

  beforeAll(async () => {
    const r = await auth.createTenantWithOwner({ tenantName: 'P2', slug, email: 'o@p2.test', password: 'Strong-Pass-123!', displayName: 'O' });
    T = r.tenantId;
    await prisma.withTenant(T, async (tx: any) => {
      const mk = async (code: string, name: string, type: string) => (await tx.account.create({ data: { tenantId: T, code, name, type } })).id;
      cash = await mk('1010', 'Cash', 'asset'); invAcc = await mk('1030', 'Inventory', 'asset');
      rev = await mk('4010', 'Revenue', 'revenue'); cogs = await mk('5010', 'COGS', 'expense');
      for (const [purpose, accountId] of [['CASH_ON_HAND', cash], ['SALES_REVENUE', rev], ['INVENTORY', invAcc], ['COGS', cogs]] as const)
        await tx.accountMapping.create({ data: { tenantId: T, purpose, accountId } });
      const fy = await tx.fiscalYear.create({ data: { tenantId: T, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
      await tx.accountingPeriod.create({ data: { tenantId: T, fiscalYearId: fy.id, name: '2026-10', startDate: new Date('2026-10-01'), endDate: new Date('2026-10-31') } });
      const unit = await tx.unitOfMeasure.create({ data: { tenantId: T, code: 'pcs', name: 'حبة' } });
      product = (await tx.product.create({ data: { tenantId: T, sku: 'SKU-1', nameAr: 'خبز', stockUnitId: unit.id } })).id;
      warehouse = (await tx.warehouse.create({ data: { tenantId: T, code: 'WH1', name: 'رئيسي' } })).id;
    });
  });

  it('AT-ACC-003: missing mapping blocks with ConfigurationError', async () => {
    await expect(prisma.withTenant(T, (tx: any) => acc.resolveAccount(tx, T, 'VAT_OUTPUT'))).rejects.toThrow(/VAT_OUTPUT/);
    const okId = await prisma.withTenant(T, (tx: any) => acc.resolveAccount(tx, T, 'INVENTORY'));
    expect(okId).toBe(invAcc);
  });

  it('AT-ACC-001/002: balanced journal posts once (idempotent), trial balance matches', async () => {
    const input = { businessDate: '2026-10-10', idempotencyKey: 'test-journal-1', lines: [ { accountId: cash, debit: '1000', credit: '0' }, { accountId: rev, debit: '0', credit: '1000' } ] };
    const e1 = await acc.postJournal(T, input);
    const e2 = await acc.postJournal(T, input);
    expect(e2.id).toBe(e1.id);
    const tb = await acc.trialBalance(T, '2026-10-31');
    const cashRow = tb.find((r: any) => r.code === '1010');
    expect(cashRow.balance).toBe('1000');
  });

  it('AT-ACC-001: reversal is linked and cannot be duplicated', async () => {
    const e = await acc.postJournal(T, { businessDate: '2026-10-11', idempotencyKey: 'test-journal-2', lines: [ { accountId: cash, debit: '50', credit: '0' }, { accountId: rev, debit: '0', credit: '50' } ] });
    const revEntry = await acc.reverseJournal(T, e.id, { businessDate: '2026-10-12', reason: 'اختبار' });
    expect(revEntry.reversalOfId ?? revEntry.reversal_of_id).toBeTruthy();
    await expect(acc.reverseJournal(T, e.id, { businessDate: '2026-10-12', reason: 'تكرار' })).rejects.toThrow(/مرتين|قيد عكس/);
  });

  it('inventory: receipt, moving-average issue, oversell blocked, retry not duplicated', async () => {
    await inv.postMovement(T, { productId: product, warehouseId: warehouse, type: 'purchase_receipt', qty: '10', unitCost: '2.00', sourceType: 'test', sourceId: 'r1', idempotencyKey: 'mv-r1', businessDate: '2026-10-10' });
    await inv.postMovement(T, { productId: product, warehouseId: warehouse, type: 'purchase_receipt', qty: '10', unitCost: '4.00', sourceType: 'test', sourceId: 'r2', idempotencyKey: 'mv-r2', businessDate: '2026-10-10' });
    const issueInput = { productId: product, warehouseId: warehouse, type: 'sale', qty: '-5', sourceType: 'test', sourceId: 's1', idempotencyKey: 'mv-s1', businessDate: '2026-10-10' };
    const m1 = await inv.postMovement(T, issueInput);
    expect(m1.unitCost.toString()).toBe('3'); // avg of 2 and 4
    const m2 = await inv.postMovement(T, issueInput);
    expect(m2.id).toBe(m1.id);
    const bal = await inv.getBalance(T, product, warehouse);
    expect(bal[0].qty.toString()).toBe('15');
    await expect(inv.postMovement(T, { ...issueInput, qty: '-100', idempotencyKey: 'mv-s2', sourceId: 's2' })).rejects.toThrow(/INSUFFICIENT|كمية/);
    const drift = await inv.reconcile(T);
    expect(drift).toEqual([]);
  });

  it('AT-INV-001: concurrent issues of last stock — exactly one concept enforced sequentially (lock path)', async () => {
    // Stock is 15; two issues of 10 each attempted concurrently: total issued must not exceed 15.
    const mk = (k: string) => inv.postMovement(T, { productId: product, warehouseId: warehouse, type: 'sale', qty: '-10', sourceType: 'test', sourceId: k, idempotencyKey: k, businessDate: '2026-10-10' }).then(() => 'ok').catch(() => 'blocked');
    const results = await Promise.all([mk('mv-c1'), mk('mv-c2')]);
    expect(results.filter(r => r === 'ok')).toHaveLength(1);
    const bal = await inv.getBalance(T, product, warehouse);
    expect(bal[0].qty.toString()).toBe('5');
  });
});
