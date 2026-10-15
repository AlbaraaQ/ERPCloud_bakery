import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigurationError, DomainError, money } from '@erpcloud/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { hashPassword, verifyPassword, newToken, hashToken } from '../auth/password';

@Injectable()
export class PlatformService {
  constructor(private prisma: PrismaService, private auth: AuthService) {}
  async bootstrap(email: string, password: string, displayName = 'Platform Owner') {
    const db = this.prisma.client;
    const existing = await db.platformUser.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return existing;
    const count = await db.platformUser.count(); if (count > 0) throw new DomainError('PLATFORM_EXISTS', 'يوجد مستخدمو منصة مسبقاً');
    return db.platformUser.create({ data: { email: email.toLowerCase(), passwordHash: await hashPassword(password), displayName, role: 'owner' } });
  }
  async login(email: string, password: string) {
    const db = this.prisma.client;
    const u = await db.platformUser.findUnique({ where: { email: email.toLowerCase() } });
    if (!u || u.status !== 'active' || !(await verifyPassword(u.passwordHash, password))) throw new UnauthorizedException('بيانات الدخول غير صحيحة');
    const token = newToken();
    await db.platformSession.create({ data: { platformUserId: u.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 8 * 3600_000) } });
    await db.$executeRaw`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type) VALUES (NULL, ${u.id}::uuid, 'platform.login', 'platform_user')`.catch(() => undefined);
    return { token, user: { id: u.id, email: u.email, displayName: u.displayName, role: u.role } };
  }
  async authenticate(token: string) {
    const db = this.prisma.client;
    const s = await db.platformSession.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!s || s.revokedAt || s.expiresAt < new Date()) throw new UnauthorizedException('انتهت جلسة المنصة');
    return db.platformUser.findUnique({ where: { id: s.platformUserId } });
  }
  private async audit(platformUserId: string, action: string, entityId?: string, after?: unknown) {
    await this.prisma.client.auditLog.create({ data: { actorUserId: platformUserId, action, entityType: 'platform', entityId: entityId ?? null, after: (after ?? undefined) as never } }).catch(() => undefined);
  }
  async createTenant(platformUserId: string, input: { name: string; slug: string; ownerEmail: string; ownerPassword: string; ownerName: string; planCode?: string }) {
    const r = await this.auth.createTenantWithOwner({ tenantName: input.name, slug: input.slug, email: input.ownerEmail, password: input.ownerPassword, displayName: input.ownerName });
    if (input.planCode) await this.assignPlan(platformUserId, r.tenantId, input.planCode);
    await this.audit(platformUserId, 'platform.tenant.created', r.tenantId, { slug: input.slug });
    return r;
  }
  async setTenantStatus(platformUserId: string, tenantId: string, status: 'active' | 'suspended' | 'readonly') {
    const db = this.prisma.client;
    const t = await db.tenant.update({ where: { id: tenantId }, data: { status } });
    await this.audit(platformUserId, `platform.tenant.${status}`, tenantId);
    return t;
  }
  async upsertPlan(platformUserId: string, input: { code: string; name: string; maxUsers?: number; maxRepresentatives?: number; features?: Record<string, unknown> }) {
    const db = this.prisma.client;
    const plan = await db.subscriptionPlan.upsert({ where: { code: input.code }, create: { code: input.code, name: input.name, maxUsers: input.maxUsers ?? 10, maxRepresentatives: input.maxRepresentatives ?? 5, features: input.features ?? {} }, update: { name: input.name, maxUsers: input.maxUsers, maxRepresentatives: input.maxRepresentatives, features: input.features as never } });
    await this.audit(platformUserId, 'platform.plan.upserted', plan.id, { code: input.code });
    return plan;
  }
  async assignPlan(platformUserId: string, tenantId: string, planCode: string) {
    const db = this.prisma.client;
    const plan = await db.subscriptionPlan.findUnique({ where: { code: planCode } });
    if (!plan) throw new ConfigurationError(`خطة غير موجودة: ${planCode}`);
    const sub = await db.tenantSubscription.upsert({ where: { tenantId }, create: { tenantId, planId: plan.id, renewsAt: new Date(Date.now() + 30 * 86400_000) }, update: { planId: plan.id, status: 'active', renewsAt: new Date(Date.now() + 30 * 86400_000) } });
    await this.audit(platformUserId, 'platform.plan.assigned', tenantId, { planCode });
    return sub;
  }
  async usage(tenantId: string) {
    return this.prisma.withPlatform(async (tx: any) => {
      const [users, representatives, invoicesThisMonth, movements] = await Promise.all([
        tx.user.count({ where: { tenantId } }),
        tx.representativeProfile.count({ where: { tenantId, isActive: true } }),
        tx.salesInvoice.count({ where: { tenantId, createdAt: { gte: new Date(new Date().toISOString().slice(0, 8) + '01') } } }),
        tx.stockMovement.count({ where: { tenantId } }),
      ]);
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, include: undefined });
      const sub = await tx.tenantSubscription.findUnique({ where: { tenantId } });
      const plan = sub ? await tx.subscriptionPlan.findUnique({ where: { id: sub.planId } }) : null;
      return { tenant: { id: tenant?.id, name: tenant?.name, status: tenant?.status }, plan: plan ? { code: plan.code, maxUsers: plan.maxUsers, maxRepresentatives: plan.maxRepresentatives, features: plan.features } : null, subscription: sub ? { status: sub.status, renewsAt: sub.renewsAt } : null, users, representatives, invoicesThisMonth, stockMovements: movements };
    });
  }
  /** Server-side entitlement/quota enforcement (AT-PLAT-001). */
  async assertQuota(tx: any, tenantId: string, kind: 'users' | 'representatives') {
    const sub = await tx.tenantSubscription.findUnique({ where: { tenantId } });
    if (!sub) return; // no plan assigned yet: provisioning phase, enforced once a plan exists
    const plan = await tx.subscriptionPlan.findUnique({ where: { id: sub.planId } });
    if (!plan) return;
    if (kind === 'representatives') { const n = await tx.representativeProfile.count({ where: { tenantId, isActive: true } }); if (n >= plan.maxRepresentatives) throw new DomainError('QUOTA_EXCEEDED', `تم بلوغ حد المناديب في الخطة (${plan.maxRepresentatives})`); }
    if (kind === 'users') { const n = await tx.user.count({ where: { tenantId } }); if (n >= plan.maxUsers) throw new DomainError('QUOTA_EXCEEDED', `تم بلوغ حد المستخدمين في الخطة (${plan.maxUsers})`); }
  }
  async grantSupportAccess(platformUserId: string, input: { tenantId: string; scope: string; reason: string; tenantConsent: boolean; hours?: number }) {
    if (!input.tenantConsent) throw new DomainError('CONSENT_REQUIRED', 'وصول الدعم يتطلب موافقة مالك المستأجر الموثقة أو أساساً قانونياً');
    const db = this.prisma.client;
    const g = await db.supportAccessGrant.create({ data: { tenantId: input.tenantId, platformUserId, scope: input.scope, reason: input.reason, tenantConsent: input.tenantConsent, expiresAt: new Date(Date.now() + (input.hours ?? 8) * 3600_000) } });
    await this.audit(platformUserId, 'platform.support_access.granted', input.tenantId, { grantId: g.id, scope: input.scope });
    return g;
  }
  async health() {
    const dbOk = await this.prisma.ping();
    const db = this.prisma.client;
    const [failedJobs, staleBackups] = await Promise.all([
      db.backgroundJob.count({ where: { status: 'failed' } }).catch(() => -1),
      db.backupJob.count({ where: { kind: 'platform_logical', status: 'verified', createdAt: { gt: new Date(Date.now() - 8 * 3600_000) } } }).catch(() => -1),
    ]);
    return { db: dbOk, failedJobs, recentVerifiedBackups: staleBackups, backupStale: staleBackups === 0, time: new Date().toISOString() };
  }
}
void money;
