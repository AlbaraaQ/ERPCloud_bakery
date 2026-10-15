import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { PurchasingService } from './purchasing.service';
import { RequirePermissions } from '../rbac/permissions.guard';
import { currentTenant } from '../tenancy/tenant-context';
@Controller('purchasing')
export class PurchasingController {
  constructor(private svc: PurchasingService) {}
  @Post('supplier-invoices') @RequirePermissions('purchasing.post')
  post(@Body() b: unknown) { const d = z.object({ partyId: z.string().uuid(), warehouseId: z.string().uuid(), businessDate: z.string(), idempotencyKey: z.string().min(8), lines: z.array(z.object({ productId: z.string().uuid(), qty: z.string(), unitCost: z.string(), lotId: z.string().uuid().optional(), taxRate: z.string().optional() })).min(1) }).parse(b); const c = currentTenant(); return this.svc.postSupplierInvoice(c.tenantId, { ...d, createdBy: c.userId }); }
}
