import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { AccountingService } from './accounting.service';
import { RequirePermissions } from '../rbac/permissions.guard';
import { currentTenant } from '../tenancy/tenant-context';
const Line = z.object({ accountId: z.string().uuid(), debit: z.string(), credit: z.string() }).passthrough();
const PostJournal = z.object({ businessDate: z.string(), description: z.string().optional(), idempotencyKey: z.string().min(8), lines: z.array(Line).min(2) });
@Controller('accounting')
export class AccountingController {
  constructor(private svc: AccountingService) {}
  @Post('journals') @RequirePermissions('accounting.journal.post')
  post(@Body() b: unknown) { const d = PostJournal.parse(b); const c = currentTenant(); return this.svc.postJournal(c.tenantId, { ...d, createdBy: c.userId }); }
  @Post('journals/reverse') @RequirePermissions('accounting.journal.reverse')
  reverse(@Body() b: unknown) { const d = z.object({ entryId: z.string().uuid(), businessDate: z.string(), reason: z.string().min(3) }).parse(b); const c = currentTenant(); return this.svc.reverseJournal(c.tenantId, d.entryId, { ...d, createdBy: c.userId }); }
  @Get('trial-balance') @RequirePermissions('accounting.view')
  tb() { const c = currentTenant(); return this.svc.trialBalance(c.tenantId, new Date().toISOString().slice(0,10)); }
}
