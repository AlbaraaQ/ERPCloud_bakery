import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}
  async notify(tx: any, tenantId: string, input: { userId: string; type: string; title: string; body?: string; refType?: string; refId?: string }) {
    return tx.notification.create({ data: { tenantId, userId: input.userId, type: input.type, title: input.title, body: input.body ?? null, refType: input.refType ?? null, refId: input.refId ?? null } });
  }
  async notifyPermissionHolders(tx: any, tenantId: string, permission: string, input: { type: string; title: string; body?: string; refType?: string; refId?: string }) {
    const users = await tx.user.findMany({ where: { tenantId, roles: { some: { role: { permissions: { some: { permission: { code: permission } } } } } } } });
    for (const u of users) await this.notify(tx, tenantId, { ...input, userId: u.id });
    return users.length;
  }
  list(tenantId: string, userId: string) { return this.prisma.withTenant(tenantId, (tx: any) => tx.notification.findMany({ where: { tenantId, userId }, orderBy: { createdAt: 'desc' }, take: 100 })); }
}
