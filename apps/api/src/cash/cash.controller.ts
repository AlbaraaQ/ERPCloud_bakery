import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { CashService } from './cash.service';
import { RequirePermissions } from '../rbac/permissions.guard';
import { currentTenant } from '../tenancy/tenant-context';
@Controller('cash')
export class CashController {
  constructor(private svc: CashService) {}
  @Post('expenses') @RequirePermissions('cash.post')
  expense(@Body() b: unknown) { const d = z.object({ category: z.string(), description: z.string().optional(), amount: z.string(), cashAccountId: z.string().uuid(), businessDate: z.string(), idempotencyKey: z.string().min(8) }).parse(b); const c = currentTenant(); return this.svc.postExpense(c.tenantId, { ...d, createdBy: c.userId }); }
  @Post('payments') @RequirePermissions('cash.post')
  payment(@Body() b: unknown) { const d = z.object({ partyId: z.string().uuid(), direction: z.enum(['in','out']), method: z.string(), amount: z.string(), cashAccountId: z.string().uuid(), businessDate: z.string(), idempotencyKey: z.string().min(8), allocateTo: z.object({ documentType: z.string(), documentId: z.string().uuid(), amount: z.string() }).optional() }).parse(b); const c = currentTenant(); return this.svc.postPayment(c.tenantId, { ...d, createdBy: c.userId }); }
}
