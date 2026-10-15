import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';

// Runs only when RUN_INTEGRATION=1 with a real DATABASE_URL (CI Postgres service).
const run = process.env.RUN_INTEGRATION === '1';
describe.skipIf(!run)('Phase1 integration (AT-SEC-001/002 partial)', () => {
  const prisma = new PrismaService();
  const auth = new AuthService(prisma, new AuditService(prisma));
  const slug = 'it-' + Math.random().toString(36).slice(2, 8);
  let tenantId = ''; let ownerPermissions: string[] = [];

  beforeAll(async () => {
    const r = await auth.createTenantWithOwner({ tenantName: 'IT', slug, email: 'owner@it.test', password: 'Strong-Pass-123!', displayName: 'Owner' });
    tenantId = r.tenantId;
  });

  it('owner logs in and gets TENANT_OWNER permissions (no platform.admin)', async () => {
    const s = await auth.login(slug, 'owner@it.test', 'Strong-Pass-123!');
    ownerPermissions = s.permissions as string[];
    expect(ownerPermissions).toContain('sales.post');
    expect(ownerPermissions).not.toContain('platform.admin');
    const ctx = await auth.authenticate(s.accessToken);
    expect(ctx.tenantId).toBe(tenantId);
  });

  it('wrong password is rejected', async () => {
    await expect(auth.login(slug, 'owner@it.test', 'wrong')).rejects.toThrow();
  });

  it('cross-tenant: a second tenant owner cannot authenticate with first tenant slug', async () => {
    const slug2 = slug + 'b';
    await auth.createTenantWithOwner({ tenantName: 'IT2', slug: slug2, email: 'o2@it.test', password: 'Strong-Pass-123!', displayName: 'O2' });
    await expect(auth.login(slug, 'o2@it.test', 'Strong-Pass-123!')).rejects.toThrow();
    const ok = await auth.login(slug2, 'o2@it.test', 'Strong-Pass-123!');
    expect(ok.user.tenantId).not.toBe(tenantId);
  });

  it('RLS: querying users without tenant context via app transaction sees only own tenant', async () => {
    const rows = await prisma.withTenant(tenantId, (tx: any) => tx.user.findMany());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((u: any) => u.tenantId === tenantId)).toBe(true);
  });
});
