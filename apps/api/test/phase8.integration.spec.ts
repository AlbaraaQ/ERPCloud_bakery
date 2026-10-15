import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { PlatformService } from '../src/platform/platform.service';
import { BackupService, HttpDriveGateway } from '../src/platform/backup.service';
import { RepresentativesService } from '../src/representatives/representatives.service';
import { NotificationsService } from '../src/notifications/notifications.service';

const run = process.env.RUN_INTEGRATION === '1';
describe.skipIf(!run)('Phase8 platform & backups (AT-PLAT-001, AT-BAK-001 partial)', () => {
  const prisma = new PrismaService();
  const auth = new AuthService(prisma, new AuditService(prisma));
  const platform = new PlatformService(prisma, auth);
  const backups = new BackupService(prisma, new HttpDriveGateway());
  const reps = new RepresentativesService(prisma, new NotificationsService(prisma), platform);
  let adminId = '', T = '';

  beforeAll(async () => {
    process.env.BACKUP_DIR = mkdtempSync(join(tmpdir(), 'erp-bak-'));
    process.env.BACKUP_ENCRYPTION_KEY = 'ci-backup-key-at-least-32-characters-long';
    const admin = await platform.bootstrap('owner@platform.test', 'Platform-Strong-123!');
    adminId = admin.id;
    await platform.upsertPlan(adminId, { code: 'tiny', name: 'Tiny', maxUsers: 3, maxRepresentatives: 1, features: { manufacturing: true } });
  });

  it('platform login is separate from tenant login; tenant created with plan', async () => {
    const s = await platform.login('owner@platform.test', 'Platform-Strong-123!');
    expect(s.user.role).toBe('owner');
    await expect(platform.login('owner@platform.test', 'wrong')).rejects.toThrow();
    const r = await platform.createTenant(adminId, { name: 'مخبز النور', slug: 'alnoor-' + Math.random().toString(36).slice(2, 6), ownerEmail: 'o@alnoor.test', ownerPassword: 'Strong-Pass-123!', ownerName: 'مالك', planCode: 'tiny' });
    T = r.tenantId;
    const usage = await platform.usage(T);
    expect(usage.users).toBe(1); expect(usage.plan.code).toBe('tiny');
  });

  it('suspension blocks tenant login but preserves data; support access requires consent', async () => {
    const slug = await prisma.withPlatform((tx: any) => tx.tenant.findUnique({ where: { id: T } }).then((t: any) => t.slug));
    await platform.setTenantStatus(adminId, T, 'suspended');
    await expect(auth.login(slug, 'o@alnoor.test', 'Strong-Pass-123!')).rejects.toThrow();
    const still = await prisma.withPlatform((tx: any) => tx.user.count({ where: { tenantId: T } }));
    expect(still).toBe(1); // data preserved
    await expect(platform.grantSupportAccess(adminId, { tenantId: T, scope: 'read_only', reason: 'فحص تذكرة دعم', tenantConsent: false })).rejects.toThrow(/CONSENT|موافقة/);
    const g = await platform.grantSupportAccess(adminId, { tenantId: T, scope: 'read_only', reason: 'فحص تذكرة دعم', tenantConsent: true });
    expect(g.id).toBeTruthy();
    await platform.setTenantStatus(adminId, T, 'active');
  });

  it('representative quota enforced by plan (maxRepresentatives=1)', async () => {
    const emps = await prisma.withTenant(T, async (tx: any) => {
      const e1 = await tx.employee.create({ data: { tenantId: T, fullName: 'مندوب ١' } });
      const e2 = await tx.employee.create({ data: { tenantId: T, fullName: 'مندوب ٢' } });
      return [e1.id, e2.id];
    });
    await reps.assign(T, { employeeId: emps[0] });
    await expect(reps.assign(T, { employeeId: emps[1] })).rejects.toThrow(/QUOTA|حد المناديب/);
  });

  it('backup is encrypted, checksum-verified; tenant export contains only that tenant; corruption detected', async () => {
    const job = await backups.createBackup({ tenantId: T });
    expect(job.status).toBe('verified'); expect(job.sha256).toHaveLength(64);
    const info = await backups.verifyArtifact(job.artifactPath);
    expect(info.tables.users).toBe(1); expect(info.tables.tenants).toBeGreaterThan(0);
    // tamper detection: corrupted copy must fail decryption/verification
    const bad = join(process.env.BACKUP_DIR!, 'bad.erp bak'.replace(' ', ''));
    writeFileSync(bad, Buffer.concat([Buffer.from((await import('node:fs')).readFileSync(job.artifactPath)), Buffer.from('x')]));
    await expect(backups.verifyArtifact(bad)).rejects.toThrow();
    const retention = await backups.applyRetention(18);
    expect(retention.kept.length).toBeLessThanOrEqual(18);
    await expect(backups.createBackup({ tenantId: T, destination: 'google_drive' })).rejects.toThrow(/Google Drive|OAuth/); // unconfigured drive = explicit failure, not fake success
  });
});
