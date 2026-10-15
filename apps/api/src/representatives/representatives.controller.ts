import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { RepresentativesService } from './representatives.service';
import { TransfersService } from '../transfers/transfers.service';
import { SettlementsService } from '../settlements/settlements.service';
import { SyncService } from '../sync/sync.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RequirePermissions } from '../rbac/permissions.guard';
import { currentTenant } from '../tenancy/tenant-context';
@Controller('representatives')
export class RepresentativesController {
  constructor(private reps: RepresentativesService, private transfers: TransfersService, private settlements: SettlementsService, private sync: SyncService, private notif: NotificationsService) {}
  @Post('assign') @RequirePermissions('representatives.manage')
  assign(@Body() b: unknown) { const d = z.object({ employeeId: z.string().uuid(), userId: z.string().uuid().optional() }).parse(b); return this.reps.assign(currentTenant().tenantId, d); }
  @Post('unassign') @RequirePermissions('representatives.manage')
  unassign(@Body() b: unknown) { const d = z.object({ employeeId: z.string().uuid() }).parse(b); return this.reps.unassign(currentTenant().tenantId, d.employeeId); }
  @Post('transfers/dispatch') @RequirePermissions('inventory.transfer.dispatch')
  dispatch(@Body() b: unknown) { const d = z.object({ fromWarehouseId: z.string().uuid(), toWarehouseId: z.string().uuid(), businessDate: z.string(), idempotencyKey: z.string().min(8), lines: z.array(z.object({ productId: z.string().uuid(), qty: z.string(), lotId: z.string().uuid().optional() })).min(1) }).parse(b); const c = currentTenant(); return this.transfers.dispatch(c.tenantId, { ...d, dispatchedBy: c.userId }); }
  @Post('transfers/receive') @RequirePermissions('inventory.transfer.receive')
  receive(@Body() b: unknown) { const d = z.object({ transferId: z.string().uuid(), businessDate: z.string(), lines: z.array(z.object({ productId: z.string().uuid(), acceptedQty: z.string(), disputedQty: z.string().optional(), disputeReason: z.string().optional() })).min(1) }).parse(b); const c = currentTenant(); return this.transfers.receive(c.tenantId, { ...d, receivedBy: c.userId }); }
  @Post('transfers/resolve') @RequirePermissions('inventory.transfer.dispatch')
  resolve(@Body() b: unknown) { const d = z.object({ transferId: z.string().uuid(), productId: z.string().uuid(), action: z.enum(['return_to_source','approve_shortage']), businessDate: z.string() }).parse(b); const c = currentTenant(); return this.transfers.resolveDispute(c.tenantId, { ...d, resolvedBy: c.userId }); }
  @Post('settlements/request') @RequirePermissions('settlement.view')
  reqSettlement(@Body() b: unknown) { const d = z.object({ employeeId: z.string().uuid(), periodStart: z.string(), periodEnd: z.string() }).parse(b); const c = currentTenant(); return this.settlements.request(c.tenantId, { ...d, createdBy: c.userId }); }
  @Post('settlements/finalize') @RequirePermissions('settlement.finalize')
  fin(@Body() b: unknown) { const d = z.object({ settlementId: z.string().uuid(), counted: z.array(z.object({ productId: z.string().uuid(), qty: z.string() })), countedCash: z.string(), cashHandedOver: z.string(), businessDate: z.string() }).parse(b); const c = currentTenant(); return this.settlements.finalize(c.tenantId, { ...d, finalizedBy: c.userId }); }
  @Post('settlements/decide-exception') @RequirePermissions('settlement.exception.approve')
  decide(@Body() b: unknown) { const d = z.object({ exceptionId: z.string().uuid(), decision: z.enum(['adjustment','employee_receivable','rejected']), reason: z.string().min(3), businessDate: z.string() }).parse(b); const c = currentTenant(); return this.settlements.decideException(c.tenantId, { ...d, decidedBy: c.userId }); }
  @Post('sync/push') @RequirePermissions('sales.create')
  push(@Body() b: unknown) { const d = z.object({ deviceId: z.string().uuid().optional(), ops: z.array(z.object({ clientOpId: z.string().min(8), type: z.string(), payload: z.any() })).min(1) }).parse(b); const c = currentTenant(); return this.sync.push(c.tenantId, { userId: c.userId, deviceId: d.deviceId, allowPriceOverride: c.permissions.includes('sales.post') }, d.ops as never); }
  @Post('sync/pull') @RequirePermissions('sales.view')
  pull(@Body() b: unknown) { const d = z.object({ warehouseId: z.string().uuid() }).parse(b); return this.sync.pull(currentTenant().tenantId, d.warehouseId); }
  @Post('notifications') @RequirePermissions('sales.view')
  notifs() { const c = currentTenant(); return this.notif.list(c.tenantId, c.userId); }
}
