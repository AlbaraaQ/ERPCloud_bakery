import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { PartiesService } from './parties.service';
import { RequirePermissions } from '../rbac/permissions.guard';
import { currentTenant } from '../tenancy/tenant-context';
@Controller('parties')
export class PartiesController {
  constructor(private svc: PartiesService) {}
  @Post() @RequirePermissions('parties.manage')
  create(@Body() b: unknown) { const d = z.object({ kind: z.enum(['customer','supplier','both']), name: z.string().min(1), phone: z.string().optional(), taxNumber: z.string().optional(), creditLimit: z.string().optional(), creditHold: z.boolean().optional(), priceListId: z.string().uuid().optional() }).parse(b); return this.svc.create(currentTenant().tenantId, d); }
  @Post('statement') @RequirePermissions('parties.view')
  stmt(@Body() b: unknown) { const d = z.object({ partyId: z.string().uuid() }).parse(b); return this.svc.statement(currentTenant().tenantId, d.partyId); }
}
