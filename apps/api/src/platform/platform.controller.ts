import { Body, Controller, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { PlatformService } from './platform.service';
import { BackupService } from './backup.service';
@Controller('platform')
export class PlatformController {
  constructor(private svc: PlatformService, private backups: BackupService) {}
  private actor(req: Request) { const u = (req as any).platformUser; if (!u) throw new UnauthorizedException('غير مصرح'); return u; }
  @Post('login')
  async login(@Body() b: unknown, @Res({ passthrough: true }) res: Response) { const d = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(b); const r = await this.svc.login(d.email, d.password); res.cookie('platform_session', r.token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' }); return { user: r.user }; }
  @Post('tenants')
  async tenant(@Body() b: unknown, @Req() req: Request) { const u = this.actor(req); const d = z.object({ name: z.string(), slug: z.string(), ownerEmail: z.string().email(), ownerPassword: z.string().min(10), ownerName: z.string(), planCode: z.string().optional() }).parse(b); return this.svc.createTenant(u.id, d); }
  @Post('tenants/status')
  async status(@Body() b: unknown, @Req() req: Request) { const u = this.actor(req); const d = z.object({ tenantId: z.string().uuid(), status: z.enum(['active', 'suspended', 'readonly']) }).parse(b); return this.svc.setTenantStatus(u.id, d.tenantId, d.status); }
  @Post('plans')
  async plan(@Body() b: unknown, @Req() req: Request) { const u = this.actor(req); const d = z.object({ code: z.string(), name: z.string(), maxUsers: z.number().optional(), maxRepresentatives: z.number().optional(), features: z.record(z.unknown()).optional() }).parse(b); return this.svc.upsertPlan(u.id, d); }
  @Post('tenants/assign-plan')
  async assign(@Body() b: unknown, @Req() req: Request) { const u = this.actor(req); const d = z.object({ tenantId: z.string().uuid(), planCode: z.string() }).parse(b); return this.svc.assignPlan(u.id, d.tenantId, d.planCode); }
  @Post('tenants/usage')
  async usage(@Body() b: unknown, @Req() req: Request) { this.actor(req); const d = z.object({ tenantId: z.string().uuid() }).parse(b); return this.svc.usage(d.tenantId); }
  @Post('support-access')
  async support(@Body() b: unknown, @Req() req: Request) { const u = this.actor(req); const d = z.object({ tenantId: z.string().uuid(), scope: z.string(), reason: z.string().min(5), tenantConsent: z.boolean(), hours: z.number().optional() }).parse(b); return this.svc.grantSupportAccess(u.id, d); }
  @Post('backups')
  async backup(@Body() b: unknown, @Req() req: Request) { this.actor(req); const d = z.object({ tenantId: z.string().uuid().optional(), destination: z.enum(['local', 'google_drive']).optional() }).parse(b ?? {}); return this.backups.createBackup(d); }
  @Post('backups/retention')
  async retention(@Req() req: Request) { this.actor(req); return this.backups.applyRetention(18); }
  @Post('health')
  async health(@Req() req: Request) { this.actor(req); return this.svc.health(); }
}
