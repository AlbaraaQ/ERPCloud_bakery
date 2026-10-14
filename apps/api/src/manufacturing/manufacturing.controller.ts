import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { ManufacturingService } from './manufacturing.service';
import { StockCountsService } from '../inventory/inventory.service';
import { RequirePermissions } from '../rbac/permissions.guard';
import { currentTenant } from '../tenancy/tenant-context';
@Controller('manufacturing')
export class ManufacturingController {
  constructor(private svc: ManufacturingService, private counts: StockCountsService) {}
  @Post('boms') @RequirePermissions('production.manage')
  bom(@Body() b: unknown) { const d = z.object({ productId: z.string().uuid(), name: z.string(), lines: z.array(z.object({ ingredientProductId: z.string().uuid(), qtyPerUnit: z.string(), wastePercent: z.string().optional() })).min(1) }).parse(b); return this.svc.createBom(currentTenant().tenantId, d); }
  @Post('orders') @RequirePermissions('production.manage')
  order(@Body() b: unknown) { const d = z.object({ bomId: z.string().uuid(), warehouseId: z.string().uuid(), plannedQty: z.string(), businessDate: z.string(), idempotencyKey: z.string().min(8) }).parse(b); const c = currentTenant(); return this.svc.createOrder(c.tenantId, { ...d, createdBy: c.userId }); }
  @Post('orders/complete') @RequirePermissions('production.post')
  complete(@Body() b: unknown) { const d = z.object({ orderId: z.string().uuid(), businessDate: z.string(), goodQty: z.string(), abnormalScrapQty: z.string().optional(), scrapReason: z.string().optional(), finishedLotCode: z.string().optional(), finishedExpiry: z.string().optional(), consumption: z.array(z.object({ productId: z.string().uuid(), actualQty: z.string(), lotId: z.string().uuid().optional() })).min(1), components: z.array(z.object({ kind: z.string(), amount: z.string() })).optional() }).parse(b); const c = currentTenant(); return this.svc.complete(c.tenantId, { ...d, createdBy: c.userId }); }
  @Post('trace') @RequirePermissions('production.view')
  trace(@Body() b: unknown) { const d = z.object({ finishedLotId: z.string().uuid().optional(), rawLotId: z.string().uuid().optional() }).parse(b); return this.svc.trace(currentTenant().tenantId, d); }
  @Post('counts') @RequirePermissions('inventory.adjust')
  count(@Body() b: unknown) { const d = z.object({ warehouseId: z.string().uuid(), businessDate: z.string(), lines: z.array(z.object({ productId: z.string().uuid(), lotId: z.string().uuid().optional(), countedQty: z.string(), reason: z.string().optional() })).min(1) }).parse(b); const c = currentTenant(); return this.counts.postCount(c.tenantId, { ...d, createdBy: c.userId }); }
  @Post('fefo') @RequirePermissions('inventory.view')
  fefo(@Body() b: unknown) { const d = z.object({ productId: z.string().uuid(), warehouseId: z.string().uuid() }).parse(b); return this.counts.fefo(currentTenant().tenantId, d.productId, d.warehouseId); }
}
