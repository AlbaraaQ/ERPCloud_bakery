import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { AiService } from './ai.service';
import { RequirePermissions } from '../rbac/permissions.guard';
import { currentTenant } from '../tenancy/tenant-context';
@Controller('ai')
export class AiController {
  constructor(private svc: AiService) {}
  @Post('configure') @RequirePermissions('tenant.configure')
  cfg(@Body() b: unknown) { const d = z.object({ provider: z.string(), baseUrl: z.string().url(), model: z.string(), secretRef: z.string(), isEnabled: z.boolean().optional() }).parse(b); return this.svc.configure(currentTenant().tenantId, d); }
  @Post('ask') @RequirePermissions('ai.use')
  ask(@Body() b: unknown) { const d = z.object({ question: z.string().min(2), args: z.record(z.unknown()).optional() }).parse(b); const c = currentTenant(); return this.svc.ask(c.tenantId, { userId: c.userId, permissions: c.permissions }, d.question, d.args); }
  @Post('decide') @RequirePermissions('ai.use')
  decide(@Body() b: unknown) { const d = z.object({ toolCallId: z.string().uuid(), decision: z.enum(['approved', 'rejected']) }).parse(b); const c = currentTenant(); return this.svc.decideApproval(c.tenantId, { userId: c.userId, permissions: c.permissions }, d.toolCallId, d.decision); }
}
