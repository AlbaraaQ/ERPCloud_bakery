import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hashPassword, verifyPassword, newToken, hashToken } from './password';
import { passwordPolicy } from '../security/security';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Creates a tenant with its owner user + seeded roles/permissions (provisioning used by platform in Phase 8; exposed for seed/tests). */
  async createTenantWithOwner(input: { tenantName: string; slug: string; email: string; password: string; displayName: string }) {
    const policyError = passwordPolicy(input.password); if (policyError) throw new Error(policyError);
    const db = this.prisma.client;
    const { PERMISSIONS, ROLE_PERMISSIONS } = await import('@erpcloud/shared');
    return this.prisma.withPlatform(async (tx: any) => {
      const tenant = await tx.tenant.create({ data: { name: input.tenantName, slug: input.slug } });
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      for (const p of PERMISSIONS) await tx.permission.upsert({ where: { code: p }, create: { code: p }, update: {} });
      const owner = await tx.user.create({ data: { tenantId: tenant.id, email: input.email.toLowerCase(), passwordHash: await hashPassword(input.password), displayName: input.displayName } });
      for (const [code, perms] of Object.entries(ROLE_PERMISSIONS)) {
        const role = await tx.role.create({ data: { tenantId: tenant.id, code, name: code } });
        const permRows = await tx.permission.findMany({ where: { code: { in: perms as unknown as string[] } } });
        for (const pr of permRows) await tx.rolePermission.create({ data: { roleId: role.id, permissionId: pr.id } });
        if (code === 'TENANT_OWNER') await tx.userRole.create({ data: { userId: owner.id, roleId: role.id } });
      }
      await tx.auditLog.create({ data: { tenantId: tenant.id, actorUserId: owner.id, action: 'tenant.provisioned', entityType: 'tenant', entityId: tenant.id } });
      return { tenantId: tenant.id, userId: owner.id };
    });
  }

  async login(tenantSlug: string, email: string, password: string, ip?: string) {
    const db = this.prisma.client;
    const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant || tenant.status === 'suspended' || tenant.status === 'deactivated') throw new UnauthorizedException('بيانات الدخول غير صحيحة');
    const user = await this.prisma.withPlatform((tx:any)=>tx.user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email: email.toLowerCase() } }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } }));
    if (!user || user.status !== 'active' || !(await verifyPassword(user.passwordHash, password))) throw new UnauthorizedException('بيانات الدخول غير صحيحة');
    const access = newToken(), refresh = newToken();
    const session = await this.prisma.withTenant(tenant.id, async (tx: any) => {
      const s = await tx.session.create({ data: { tenantId: tenant.id, userId: user.id, tokenHash: hashToken(access), refreshHash: hashToken(refresh), expiresAt: new Date(Date.now() + 1000*60*60*24*7) } });
      await tx.auditLog.create({ data: { tenantId: tenant.id, actorUserId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, ip: ip ?? null } });
      return s;
    });
    const permissions = [...new Set(user.roles.flatMap((ur: any) => ur.role.permissions.map((rp: any) => rp.permission.code)))];
    return { accessToken: access, refreshToken: refresh, sessionId: session.id, user: { id: user.id, email: user.email, displayName: user.displayName, tenantId: tenant.id }, permissions };
  }

  async authenticate(accessToken: string) {
    const db = this.prisma.client;
    const s = await this.prisma.withPlatform((tx:any)=>tx.session.findUnique({ where: { tokenHash: hashToken(accessToken) } }));
    if (!s || s.revokedAt || s.expiresAt < new Date()) throw new UnauthorizedException('انتهت الجلسة');
    const user = await this.prisma.withTenant(s.tenantId, (tx:any)=>tx.user.findUnique({ where: { id: s.userId }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } }));
    if (!user || user.status !== 'active') throw new UnauthorizedException('انتهت الجلسة');
    const permissions = [...new Set(user.roles.flatMap((ur: any) => ur.role.permissions.map((rp: any) => rp.permission.code)))];
    return { tenantId: s.tenantId as string, userId: user.id as string, permissions: permissions as string[] };
  }

  /** Refresh rotation: the old session is revoked and a brand-new token pair is issued.
   *  Presenting an already-rotated refresh token revokes nothing new but is rejected. */
  async refresh(refreshToken: string) {
    const db = this.prisma.client;
    const s = await this.prisma.withPlatform((tx: any) => tx.session.findUnique({ where: { refreshHash: hashToken(refreshToken) } }));
    if (!s || s.revokedAt || s.expiresAt < new Date()) throw new UnauthorizedException('انتهت الجلسة — سجّل الدخول مجدداً');
    const access = newToken(), refresh = newToken();
    await this.prisma.withTenant(s.tenantId, async (tx: any) => {
      await tx.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
      await tx.session.create({ data: { tenantId: s.tenantId, userId: s.userId, tokenHash: hashToken(access), refreshHash: hashToken(refresh), expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7) } });
      await tx.auditLog.create({ data: { tenantId: s.tenantId, actorUserId: s.userId, action: 'auth.refresh_rotated', entityType: 'session', entityId: s.id } });
    });
    return { accessToken: access, refreshToken: refresh };
  }

  async logout(accessToken: string) {
    await this.prisma.client.session.updateMany({ where: { tokenHash: hashToken(accessToken), revokedAt: null }, data: { revokedAt: new Date() } });
    return { ok: true };
  }
}
