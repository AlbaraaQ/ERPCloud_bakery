import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { SalesService } from './sales.service';
import { RequirePermissions } from '../rbac/permissions.guard';
import { currentTenant, tenantStorage } from '../tenancy/tenant-context';
const Line = z.object({ productId: z.string().uuid(), qty: z.string(), freeQty: z.string().optional(), requestedPrice: z.string().optional(), discount: z.string().optional(), lotId: z.string().uuid().optional(), overrideApprovedBy: z.string().uuid().optional(), overrideReason: z.string().optional() });
const Sale = z.object({ partyId: z.string().uuid().optional(), warehouseId: z.string().uuid(), representativeId: z.string().uuid().optional(), businessDate: z.string(), idempotencyKey: z.string().min(8), lines: z.array(Line).min(1), payments: z.array(z.object({ method: z.string(), amount: z.string() })).optional() });
@Controller('sales')
export class SalesController {
  constructor(private svc: SalesService) {}
  @Post('invoices/draft') @RequirePermissions('sales.create')
  draft(@Body() b: unknown) { const d = Sale.parse(b); const c = currentTenant(); return this.svc.createInvoice(c.tenantId, d, { post: false, createdBy: c.userId }); }
  @Post('invoices') @RequirePermissions('sales.post')
  post(@Body() b: unknown) { const d = Sale.parse(b); const c = currentTenant(); return this.svc.createInvoice(c.tenantId, d, { post: true, createdBy: c.userId, allowPriceOverride: c.permissions.includes('sales.post') }); }
  @Post('invoices/post-draft') @RequirePermissions('sales.post')
  postDraft(@Body() b: unknown) { const d = z.object({ invoiceId: z.string().uuid(), payments: z.array(z.object({ method: z.string(), amount: z.string() })).optional() }).parse(b); const c = currentTenant(); return this.svc.postDraft(c.tenantId, d.invoiceId, { payments: d.payments, createdBy: c.userId }); }
  @Post('returns') @RequirePermissions('sales.post')
  ret(@Body() b: unknown) { const d = z.object({ originalInvoiceId: z.string().uuid(), warehouseId: z.string().uuid(), businessDate: z.string(), idempotencyKey: z.string().min(8), lines: z.array(z.object({ productId: z.string().uuid(), qty: z.string() })).min(1) }).parse(b); const c = currentTenant(); return this.svc.createReturn(c.tenantId, { ...d, createdBy: c.userId }); }
}
void tenantStorage;
