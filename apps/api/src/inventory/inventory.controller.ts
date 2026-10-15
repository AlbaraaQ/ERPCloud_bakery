import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { InventoryService } from './inventory.service';
import { RequirePermissions } from '../rbac/permissions.guard';
import { currentTenant } from '../tenancy/tenant-context';
const Move = z.object({ productId: z.string().uuid(), warehouseId: z.string().uuid(), lotId: z.string().uuid().optional(), type: z.string(), qty: z.string(), unitCost: z.string().optional(), sourceType: z.string(), sourceId: z.string(), idempotencyKey: z.string().min(8), businessDate: z.string() });
@Controller('inventory')
export class InventoryController {
  constructor(private svc: InventoryService) {}
  @Post('movements') @RequirePermissions('inventory.adjust')
  move(@Body() b: unknown) { const d = Move.parse(b); const c = currentTenant(); return this.svc.postMovement(c.tenantId, { ...d, createdBy: c.userId }); }
  @Post('reconcile') @RequirePermissions('inventory.view')
  rec() { return this.svc.reconcile(currentTenant().tenantId); }
}
