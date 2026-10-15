import { CanActivate, ExecutionContext, Injectable, SetMetadata, ForbiddenException } from '@nestjs/common';
import 'reflect-metadata';
import { tenantStorage } from '../tenancy/tenant-context';
export const PERMS_KEY = 'required_permissions';
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMS_KEY, perms);
/** Pure decision function — unit-tested (AT-SEC-002 skeleton). */
export function hasPermissions(granted: string[], required: string[]): boolean { return required.every(r => granted.includes(r)); }
@Injectable()
export class PermissionsGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    // Read metadata directly: APP_GUARD instantiation does not reliably inject Reflector
    // across testing/production containers, and a guard must never 500 a public route.
    const required: string[] = Reflect.getMetadata(PERMS_KEY, ctx.getHandler()) ?? Reflect.getMetadata(PERMS_KEY, ctx.getClass()) ?? [];
    if (required.length === 0) return true;
    const store = tenantStorage.getStore();
    if (!store) throw new ForbiddenException('غير مصرح');
    if (!hasPermissions(store.permissions, required)) throw new ForbiddenException('صلاحية غير كافية: ' + required.join(','));
    return true;
  }
}
