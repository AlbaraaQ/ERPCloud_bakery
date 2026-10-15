import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { TaxService } from './tax.service';
import { RequirePermissions } from '../rbac/permissions.guard';
import { currentTenant } from '../tenancy/tenant-context';
@Controller('tax')
export class TaxController {
  constructor(private svc: TaxService) {}
  @Post('configure') @RequirePermissions('tax.configure')
  cfg(@Body() b: unknown) { const d = z.object({ vatRegistered: z.boolean(), vatNumber: z.string().optional() }).parse(b); return this.svc.configure(currentTenant().tenantId, d); }
  @Post('credentials') @RequirePermissions('tax.configure')
  cred(@Body() b: unknown) { const d = z.object({ environment: z.enum(['sandbox', 'production']), secretRef: z.string() }).parse(b); return this.svc.registerCredential(currentTenant().tenantId, d); }
  @Post('submit-invoice') @RequirePermissions('tax.submit')
  submit(@Body() b: unknown) { const d = z.object({ invoiceId: z.string().uuid(), environment: z.enum(['sandbox', 'production']).optional() }).parse(b); return this.svc.submitInvoice(currentTenant().tenantId, d.invoiceId, { environment: d.environment }); }
  @Post('submissions') @RequirePermissions('tax.view')
  list(@Body() b: unknown) { const d = z.object({ environment: z.enum(['sandbox', 'production']).optional() }).parse(b ?? {}); return this.svc.listSubmissions(currentTenant().tenantId, d.environment); }
  @Post('period-summary') @RequirePermissions('tax.view')
  summary(@Body() b: unknown) { const d = z.object({ from: z.string(), to: z.string() }).parse(b); return this.svc.periodSummary(currentTenant().tenantId, d.from, d.to); }
}
