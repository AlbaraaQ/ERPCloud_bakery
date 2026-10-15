import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';

const run = process.env.RUN_INTEGRATION === '1';
describe.skipIf(!run)('Phase10 HTTP E2E + hardening + restore drill', () => {
  let app: INestApplication; let base = ''; let cookie = ''; let refreshCookie = ''; let tenantId = '';
  const slug = 'p10-' + Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    process.env.BACKUP_DIR = mkdtempSync(join(tmpdir(), 'erp-drill-'));
    process.env.BACKUP_ENCRYPTION_KEY = 'ci-backup-key-at-least-32-characters-long';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication(); app.setGlobalPrefix('api/v1'); app.use(cookieParser());
    const { ArgumentsHost, Catch, ExceptionFilter, HttpException } = await import('@nestjs/common');
    @Catch() class DebugFilter implements ExceptionFilter { catch(e: any, host: ArgumentsHost) { const res = host.switchToHttp().getResponse(); res.status(e instanceof HttpException ? e.getStatus() : 500).json({ debug: String(e?.stack ?? e).slice(0, 800) }); } }
    app.useGlobalFilters(new DebugFilter());
    await app.listen(0);
    const addr = app.getHttpServer().address(); base = `http://127.0.0.1:${addr.port}`;
    const { PrismaService } = await import('../src/prisma/prisma.service');
    const { AuditService } = await import('../src/audit/audit.service');
    const { AuthService } = await import('../src/auth/auth.service');
    const prisma = new PrismaService();
    const auth = new AuthService(prisma, new AuditService(prisma));
    const r = await auth.createTenantWithOwner({ tenantName: 'P10', slug, email: 'o@p10.test', password: 'Strong-Pass-123!', displayName: 'Owner' });
    tenantId = r.tenantId;
  });
  afterAll(async () => { await app?.close(); });

  const post = async (path: string, body?: unknown, ck?: string) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined });

  it('health is public; protected routes reject anonymous (401)', async () => {
    const h = await fetch(base + '/api/v1/health'); if (h.status !== 200) throw new Error('HEALTH_BODY:' + (await h.text()).slice(0, 400));
    expect((await post('/api/v1/reports/dashboard')).status).toBe(401);
  });

  it('login over HTTP sets httpOnly cookies and never returns tokens in body', async () => {
    const bad = await post('/api/v1/auth/login', { tenantSlug: slug, email: 'o@p10.test', password: 'wrong' });
    expect(bad.status).toBe(401);
    const ok = await post('/api/v1/auth/login', { tenantSlug: slug, email: 'o@p10.test', password: 'Strong-Pass-123!' });
    expect(ok.status).toBe(201);
    const setCookie = ok.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('erp_session='); expect(setCookie.toLowerCase()).toContain('httponly');
    cookie = setCookie.split(',').map(s => s.split(';')[0].trim()).filter(s => s.startsWith('erp_session=')).join('; ');
    refreshCookie = setCookie.split(',').map(s => s.split(';')[0].trim()).filter(s => s.startsWith('erp_refresh=')).join('; ');
    const body = await ok.text();
    expect(body).not.toContain('accessToken');
  });

  it('authenticated dashboard works; refresh rotates and old refresh is dead', async () => {
    const dash = await post('/api/v1/reports/dashboard', undefined, cookie);
    expect(dash.status).toBe(201);
    const refreshed = await post('/api/v1/auth/refresh', undefined, refreshCookie);
    expect(refreshed.status).toBe(201);
    const replay = await post('/api/v1/auth/refresh', undefined, refreshCookie);
    expect(replay.status).toBe(401); // rotated token cannot be replayed
  });

  it('backup restore drill: artifact decrypts and row counts match the live tenant', async () => {
    const { PrismaService } = await import('../src/prisma/prisma.service');
    const { BackupService, HttpDriveGateway } = await import('../src/platform/backup.service');
    const prisma = new PrismaService();
    const backups = new BackupService(prisma, new HttpDriveGateway());
    const job = await backups.createBackup({ tenantId });
    expect(job.status).toBe('verified');
    const info = await backups.verifyArtifact(job.artifactPath);
    const liveUsers = await prisma.withTenant(tenantId, (tx: any) => tx.user.count({ where: { tenantId } }));
    expect(info.tables.users).toBe(liveUsers);
    expect(info.sha256).toBe(job.sha256);
  });
});
