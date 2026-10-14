import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}
  async log(input: { tenantId?: string; actorUserId?: string; action: string; entityType: string; entityId?: string; before?: unknown; after?: unknown; ip?: string }) {
    return this.prisma.client.auditLog.create({ data: { tenantId: input.tenantId ?? null, actorUserId: input.actorUserId ?? null, action: input.action, entityType: input.entityType, entityId: input.entityId ?? null, before: (input.before ?? undefined) as never, after: (input.after ?? undefined) as never, ip: input.ip ?? null } });
  }
}
