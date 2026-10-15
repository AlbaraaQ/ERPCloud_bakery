import { Injectable } from '@nestjs/common';
import { DomainError } from '@erpcloud/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformService } from '../platform/platform.service';

@Injectable()
export class RepresentativesService {
  constructor(private prisma: PrismaService, private notif: NotificationsService, private platform: PlatformService) {}
  /** AT-REP-001: assigning the rep role creates exactly one linked warehouse, idempotently. */
  async assign(tenantId: string, input: { employeeId: string; userId?: string }) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const existing = await tx.representativeProfile.findUnique({ where: { employeeId: input.employeeId } });
      if (existing) { if (!existing.isActive) await tx.representativeProfile.update({ where: { id: existing.id }, data: { isActive: true, userId: input.userId ?? existing.userId } }); return tx.representativeProfile.findUnique({ where: { id: existing.id } }); }
      await this.platform.assertQuota(tx, tenantId, 'representatives');
      const emp = await tx.employee.findUnique({ where: { id: input.employeeId } });
      if (!emp || emp.tenantId !== tenantId) throw new DomainError('NOT_FOUND', 'الموظف غير موجود');
      const byWh = await tx.warehouse.findUnique({ where: { employeeId: input.employeeId } });
      const warehouse = byWh ?? await tx.warehouse.create({ data: { tenantId, code: `REP-${input.employeeId.slice(0, 8)}`, name: `مستودع المندوب ${emp.fullName}`, kind: 'representative', employeeId: input.employeeId } });
      const profile = await tx.representativeProfile.create({ data: { tenantId, employeeId: input.employeeId, userId: input.userId ?? null, warehouseId: warehouse.id } });
      await tx.auditLog.create({ data: { tenantId, action: 'representative.assigned', entityType: 'employee', entityId: input.employeeId, after: { warehouseId: warehouse.id } } });
      return profile;
    });
  }
  /** AT-REP-002: removal never deletes history; blocked while custody stock remains. */
  async unassign(tenantId: string, employeeId: string) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const profile = await tx.representativeProfile.findUnique({ where: { employeeId } });
      if (!profile) throw new DomainError('NOT_FOUND', 'لا يوجد ملف مندوب');
      const stock = await tx.stockBalance.aggregate({ where: { tenantId, warehouseId: profile.warehouseId }, _sum: { qty: true } });
      if (stock._sum.qty && Number(stock._sum.qty) !== 0) throw new DomainError('CUSTODY_NOT_EMPTY', 'لا يمكن إلغاء دور المندوب مع وجود عهدة مخزون — سوِّ العهدة أو حوّلها رسمياً أولاً');
      return tx.representativeProfile.update({ where: { id: profile.id }, data: { isActive: false } });
    });
  }
  async transitWarehouse(tx: any, tenantId: string) {
    return (await tx.warehouse.findFirst({ where: { tenantId, code: 'IN-TRANSIT' } })) ?? tx.warehouse.create({ data: { tenantId, code: 'IN-TRANSIT', name: 'بضاعة بالطريق', kind: 'transit' } });
  }
}
void NotificationsService;
