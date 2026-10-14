import { CanActivate, ExecutionContext, Injectable, SetMetadata, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tenantStorage } from '../tenancy/tenant-context';
export const PERMS_KEY = 'required_permissions';
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMS_KEY, perms);
/** Pure decision function — unit-tested (AT-SEC-002 skeleton). */
export function hasPermissions(granted: string[], required: string[]): boolean { return required.every(r => granted.includes(r)); }
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMS_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    if (required.length === 0) return true;
    const store = tenantStorage.getStore();
    if (!store) throw new ForbiddenException('غير مصرح');
    if (!hasPermissions(store.permissions, required)) throw new ForbiddenException('صلاحية غير كافية: ' + required.join(','));
    return true;
  }
}
