import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { ReportingService, toCsv } from './reporting.service';
import { AccountingService } from '../accounting/accounting.service';
import { RequirePermissions } from '../rbac/permissions.guard';
import { currentTenant } from '../tenancy/tenant-context';
const Range = z.object({ from: z.string(), to: z.string() });
@Controller('reports')
export class ReportingController {
  constructor(private svc: ReportingService, private acc: AccountingService) {}
  @Post('trial-balance') @RequirePermissions('reports.view')
  tb(@Body() b: unknown) { const d = z.object({ asOf: z.string() }).parse(b); return this.acc.trialBalance(currentTenant().tenantId, d.asOf); }
  @Post('income-statement') @RequirePermissions('reports.view')
  is(@Body() b: unknown) { const d = Range.parse(b); return this.svc.incomeStatement(currentTenant().tenantId, d.from, d.to); }
  @Post('balance-sheet') @RequirePermissions('reports.view')
  bs(@Body() b: unknown) { const d = z.object({ asOf: z.string() }).parse(b); return this.svc.balanceSheet(currentTenant().tenantId, d.asOf); }
  @Post('ledger') @RequirePermissions('reports.view')
  ledger(@Body() b: unknown) { const d = Range.extend({ accountCode: z.string() }).parse(b); return this.svc.generalLedger(currentTenant().tenantId, d.accountCode, d.from, d.to); }
  @Post('aging') @RequirePermissions('reports.view')
  aging(@Body() b: unknown) { const d = z.object({ kind: z.enum(['customer', 'supplier']), asOf: z.string() }).parse(b); return this.svc.aging(currentTenant().tenantId, d.kind, d.asOf); }
  @Post('sales') @RequirePermissions('reports.view')
  sales(@Body() b: unknown) { const d = Range.extend({ groupBy: z.enum(['product', 'representative', 'party']).optional() }).parse(b); return this.svc.salesReport(currentTenant().tenantId, d.from, d.to, d.groupBy); }
  @Post('inventory-valuation') @RequirePermissions('reports.view')
  val() { return this.svc.inventoryValuation(currentTenant().tenantId); }
  @Post('reconciliations') @RequirePermissions('reports.view')
  rec(@Body() b: unknown) { const d = z.object({ asOf: z.string() }).parse(b); return this.svc.reconciliations(currentTenant().tenantId, d.asOf); }
  @Post('dashboard') @RequirePermissions('reports.view')
  dash() { return this.svc.dashboard(currentTenant().tenantId); }
  @Post('sales.csv') @RequirePermissions('reports.export')
  async salesCsv(@Body() b: unknown) { const d = Range.parse(b); const rows = await this.svc.salesReport(currentTenant().tenantId, d.from, d.to); return { filename: 'sales.csv', contentType: 'text/csv; charset=utf-8', content: toCsv(rows as never) }; }
}
