import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Master data the ERP cannot run without: chart of accounts, account mappings,
 *  fiscal years/periods, units, products, warehouses, cash accounts + list views
 *  for the operational screens. Everything is tenant-scoped via RLS (withTenant). */
@Injectable()
export class MasterDataService {
  constructor(private prisma: PrismaService) {}

  listAccounts(t: string) { return this.prisma.withTenant(t, (tx: any) => tx.account.findMany({ where: { tenantId: t }, orderBy: { code: 'asc' } })); }
  createAccount(t: string, d: any) { return this.prisma.withTenant(t, (tx: any) => tx.account.create({ data: { tenantId: t, code: d.code, name: d.name, type: d.type, groupId: d.groupId ?? null } })); }

  listMappings(t: string) { return this.prisma.withTenant(t, (tx: any) => tx.accountMapping.findMany({ where: { tenantId: t }, orderBy: { purpose: 'asc' } })); }
  async setMapping(t: string, purpose: string, accountId: string) {
    return this.prisma.withTenant(t, async (tx: any) => {
      const acc = await tx.account.findFirst({ where: { tenantId: t, id: accountId } });
      if (!acc) throw new Error('الحساب غير موجود في هذا المستأجر');
      return tx.accountMapping.upsert({ where: { tenantId_purpose: { tenantId: t, purpose } }, create: { tenantId: t, purpose, accountId }, update: { accountId } });
    });
  }

  listFiscalYears(t: string) { return this.prisma.withTenant(t, (tx: any) => tx.fiscalYear.findMany({ where: { tenantId: t }, include: { periods: { orderBy: { startDate: 'asc' } } }, orderBy: { startDate: 'asc' } })); }
  /** Creates a fiscal year and its 12 monthly open periods in one step. */
  async createFiscalYear(t: string, d: { name: string; startDate: string; endDate: string }) {
    return this.prisma.withTenant(t, async (tx: any) => {
      const fy = await tx.fiscalYear.create({ data: { tenantId: t, name: d.name, startDate: new Date(d.startDate), endDate: new Date(d.endDate) } });
      const start = new Date(d.startDate); const end = new Date(d.endDate);
      let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
      while (cur <= end) {
        const periodEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0));
        await tx.accountingPeriod.create({ data: { tenantId: t, fiscalYearId: fy.id, name: `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}`, startDate: new Date(cur), endDate: periodEnd > end ? new Date(end) : periodEnd, status: 'open' } });
        cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
      }
      return fy;
    });
  }

  listUnits(t: string) { return this.prisma.withTenant(t, (tx: any) => tx.unitOfMeasure.findMany({ where: { tenantId: t }, orderBy: { code: 'asc' } })); }
  createUnit(t: string, d: any) { return this.prisma.withTenant(t, (tx: any) => tx.unitOfMeasure.create({ data: { tenantId: t, code: d.code, name: d.name } })); }

  listProducts(t: string) { return this.prisma.withTenant(t, (tx: any) => tx.product.findMany({ where: { tenantId: t }, orderBy: { sku: 'asc' } })); }
  createProduct(t: string, d: any) { return this.prisma.withTenant(t, (tx: any) => tx.product.create({ data: { tenantId: t, sku: d.sku, nameAr: d.nameAr, nameEn: d.nameEn ?? null, barcode: d.barcode ?? null, stockUnitId: d.stockUnitId, defaultPrice: d.defaultPrice ?? '0', minPrice: d.minPrice ?? null, maxPrice: d.maxPrice ?? null, taxRate: d.taxRate ?? null, taxCategory: d.taxCategory ?? null, lotTracked: !!d.lotTracked, expiryTracked: !!d.expiryTracked } })); }

  listWarehouses(t: string) { return this.prisma.withTenant(t, (tx: any) => tx.warehouse.findMany({ where: { tenantId: t }, orderBy: { code: 'asc' } })); }
  createWarehouse(t: string, d: any) { return this.prisma.withTenant(t, (tx: any) => tx.warehouse.create({ data: { tenantId: t, code: d.code, name: d.name, kind: d.kind ?? 'main' } })); }

  listParties(t: string) { return this.prisma.withTenant(t, (tx: any) => tx.party.findMany({ where: { tenantId: t }, orderBy: { name: 'asc' } })); }

  listCashAccounts(t: string) { return this.prisma.withTenant(t, (tx: any) => tx.cashAccount.findMany({ where: { tenantId: t }, orderBy: { name: 'asc' } })); }
  createCashAccount(t: string, d: any) { return this.prisma.withTenant(t, (tx: any) => tx.cashAccount.create({ data: { tenantId: t, name: d.name, kind: d.kind ?? 'cash', accountId: d.accountId } })); }

  listStockBalances(t: string) { return this.prisma.withTenant(t, (tx: any) => tx.stockBalance.findMany({ where: { tenantId: t }, orderBy: [{ warehouseId: 'asc' }, { productId: 'asc' }] })); }
  listInvoices(t: string) { return this.prisma.withTenant(t, (tx: any) => tx.salesInvoice.findMany({ where: { tenantId: t }, orderBy: { createdAt: 'desc' }, take: 100 })); }
  listJournals(t: string) { return this.prisma.withTenant(t, (tx: any) => tx.journalEntry.findMany({ where: { tenantId: t }, include: { lines: true }, orderBy: { createdAt: 'desc' }, take: 100 })); }
  listSupplierInvoices(t: string) { return this.prisma.withTenant(t, (tx: any) => tx.supplierInvoice.findMany({ where: { tenantId: t }, orderBy: { createdAt: 'desc' }, take: 100 })); }
  listExpenses(t: string) { return this.prisma.withTenant(t, (tx: any) => tx.expense.findMany({ where: { tenantId: t }, orderBy: { createdAt: 'desc' }, take: 100 })); }

  listEmployees(t: string) { return this.prisma.withTenant(t, (tx: any) => tx.employee.findMany({ where: { tenantId: t }, orderBy: { fullName: 'asc' } })); }
  createEmployee(t: string, d: any) { return this.prisma.withTenant(t, (tx: any) => tx.employee.create({ data: { tenantId: t, fullName: d.fullName } })); }
  listRepresentatives(t: string) { return this.prisma.withTenant(t, (tx: any) => tx.representativeProfile.findMany({ where: { tenantId: t } })); }
  listTransfers(t: string) { return this.prisma.withTenant(t, (tx: any) => tx.stockTransfer.findMany({ where: { tenantId: t }, include: { lines: true }, orderBy: { createdAt: 'desc' }, take: 100 })); }
  listSettlements(t: string) { return this.prisma.withTenant(t, (tx: any) => tx.settlement.findMany({ where: { tenantId: t }, include: { lines: true, exceptions: true }, orderBy: { createdAt: 'desc' }, take: 100 })); }
  listBoms(t: string) { return this.prisma.withTenant(t, (tx: any) => tx.bom.findMany({ where: { tenantId: t }, include: { lines: true }, orderBy: { createdAt: 'desc' } })); }
  listProductionOrders(t: string) { return this.prisma.withTenant(t, (tx: any) => tx.productionOrder.findMany({ where: { tenantId: t }, orderBy: { createdAt: 'desc' }, take: 100 })); }

  async updateTenantTax(t: string, d: { vatRegistered: boolean; vatNumber?: string }) {
    return this.prisma.withTenant(t, (tx: any) => tx.tenant.update({ where: { id: t }, data: { vatRegistered: d.vatRegistered, vatNumber: d.vatNumber ?? null } }));
  }
  getTenant(t: string) { return this.prisma.withTenant(t, (tx: any) => tx.tenant.findUnique({ where: { id: t } })); }
}
