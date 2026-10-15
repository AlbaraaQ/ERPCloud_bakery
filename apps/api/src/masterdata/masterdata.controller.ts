import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { MasterDataService } from './masterdata.service';
import { RequirePermissions } from '../rbac/permissions.guard';
import { currentTenant } from '../tenancy/tenant-context';

const uuid = z.string().uuid();
@Controller('master')
export class MasterDataController {
  constructor(private svc: MasterDataService) {}
  private t() { return currentTenant().tenantId; }

  @Post('accounts') @RequirePermissions('accounting.view') listAccounts() { return this.svc.listAccounts(this.t()); }
  @Post('accounts/create') @RequirePermissions('accounting.configure')
  createAccount(@Body() b: unknown) { const d = z.object({ code: z.string().min(1), name: z.string().min(1), type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']), groupId: uuid.optional() }).parse(b); return this.svc.createAccount(this.t(), d); }

  @Post('mappings') @RequirePermissions('accounting.view') listMappings() { return this.svc.listMappings(this.t()); }
  @Post('mappings/set') @RequirePermissions('accounting.configure')
  setMapping(@Body() b: unknown) { const d = z.object({ purpose: z.string().min(2), accountId: uuid }).parse(b); return this.svc.setMapping(this.t(), d.purpose, d.accountId); }

  @Post('fiscal-years') @RequirePermissions('accounting.view') listFy() { return this.svc.listFiscalYears(this.t()); }
  @Post('fiscal-years/create') @RequirePermissions('accounting.configure')
  createFy(@Body() b: unknown) { const d = z.object({ name: z.string().min(1), startDate: z.string(), endDate: z.string() }).parse(b); return this.svc.createFiscalYear(this.t(), d); }

  @Post('units') @RequirePermissions('products.view') listUnits() { return this.svc.listUnits(this.t()); }
  @Post('units/create') @RequirePermissions('products.manage')
  createUnit(@Body() b: unknown) { const d = z.object({ code: z.string().min(1), name: z.string().min(1) }).parse(b); return this.svc.createUnit(this.t(), d); }

  @Post('products') @RequirePermissions('products.view') listProducts() { return this.svc.listProducts(this.t()); }
  @Post('products/create') @RequirePermissions('products.manage')
  createProduct(@Body() b: unknown) { const d = z.object({ sku: z.string().min(1), nameAr: z.string().min(1), nameEn: z.string().optional(), barcode: z.string().optional(), stockUnitId: uuid, defaultPrice: z.string().optional(), minPrice: z.string().optional(), maxPrice: z.string().optional(), taxRate: z.string().optional(), taxCategory: z.string().optional(), lotTracked: z.boolean().optional(), expiryTracked: z.boolean().optional() }).parse(b); return this.svc.createProduct(this.t(), d); }

  @Post('warehouses') @RequirePermissions('inventory.view') listWarehouses() { return this.svc.listWarehouses(this.t()); }
  @Post('warehouses/create') @RequirePermissions('tenant.configure')
  createWarehouse(@Body() b: unknown) { const d = z.object({ code: z.string().min(1), name: z.string().min(1), kind: z.string().optional() }).parse(b); return this.svc.createWarehouse(this.t(), d); }

  @Post('parties') @RequirePermissions('parties.view') listParties() { return this.svc.listParties(this.t()); }

  @Post('cash-accounts') @RequirePermissions('cash.view') listCash() { return this.svc.listCashAccounts(this.t()); }
  @Post('cash-accounts/create') @RequirePermissions('tenant.configure')
  createCash(@Body() b: unknown) { const d = z.object({ name: z.string().min(1), kind: z.enum(['cash', 'bank']).optional(), accountId: uuid }).parse(b); return this.svc.createCashAccount(this.t(), d); }

  @Post('stock-balances') @RequirePermissions('inventory.view') stock() { return this.svc.listStockBalances(this.t()); }
  @Post('invoices') @RequirePermissions('sales.view') invoices() { return this.svc.listInvoices(this.t()); }
  @Post('supplier-invoices') @RequirePermissions('purchasing.view') supplierInvoices() { return this.svc.listSupplierInvoices(this.t()); }
  @Post('journals') @RequirePermissions('accounting.view') journals() { return this.svc.listJournals(this.t()); }
  @Post('expenses') @RequirePermissions('cash.view') expenses() { return this.svc.listExpenses(this.t()); }

  @Post('employees') @RequirePermissions('employees.view') listEmployees() { return this.svc.listEmployees(this.t()); }
  @Post('employees/create') @RequirePermissions('employees.manage')
  createEmployee(@Body() b: unknown) { const d = z.object({ fullName: z.string().min(1) }).parse(b); return this.svc.createEmployee(this.t(), d); }
  @Post('representatives') @RequirePermissions('representatives.view') listReps() { return this.svc.listRepresentatives(this.t()); }
  @Post('transfers') @RequirePermissions('representatives.view') listTransfers() { return this.svc.listTransfers(this.t()); }
  @Post('settlements') @RequirePermissions('settlement.view') listSettlements() { return this.svc.listSettlements(this.t()); }
  @Post('boms') @RequirePermissions('production.view') listBoms() { return this.svc.listBoms(this.t()); }
  @Post('production-orders') @RequirePermissions('production.view') listOrders() { return this.svc.listProductionOrders(this.t()); }

  @Post('tenant') @RequirePermissions('tenant.configure') tenant() { return this.svc.getTenant(this.t()); }
  @Post('tenant/tax') @RequirePermissions('tax.configure')
  tenantTax(@Body() b: unknown) { const d = z.object({ vatRegistered: z.boolean(), vatNumber: z.string().optional() }).parse(b); return this.svc.updateTenantTax(this.t(), d); }
}
