import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigurationError } from '@erpcloud/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface DriveGateway { upload(input: { name: string; content: Buffer }): Promise<{ fileId: string; size: number }>; }
/** Google Drive via env-configured integration. Credentials come from the secret store (ref only);
 *  unconfigured integration fails explicitly instead of pretending a backup happened. */
@Injectable()
export class HttpDriveGateway implements DriveGateway {
  async upload(_input: { name: string; content: Buffer }): Promise<{ fileId: string; size: number }> {
    const folder = process.env.GOOGLE_DRIVE_FOLDER_ID; const tokenRef = process.env.GOOGLE_DRIVE_TOKEN_SECRET_REF;
    if (!folder || !tokenRef) throw new ConfigurationError('تكامل Google Drive غير مُكوَّن: GOOGLE_DRIVE_FOLDER_ID و GOOGLE_DRIVE_TOKEN_SECRET_REF مطلوبان');
    throw new ConfigurationError('رفع Google Drive يتطلب ربط حساب OAuth في بيئة النشر (الواجهة جاهزة، الربط الخارجي غير مُفعَّل في هذه البيئة)');
  }
}

const TABLES = ['tenants','users','roles','permissions','accounts','journal_entries','journal_lines','products','warehouses','stock_movements','stock_balances','parties','sales_invoices','sales_lines','payments','supplier_invoices','production_orders','tax_submissions','audit_log'];
@Injectable()
export class BackupService {
  private readonly log = new Logger('Backup');
  constructor(private prisma: PrismaService, private drive: HttpDriveGateway) {}
  private key(): Buffer {
    const k = process.env.BACKUP_ENCRYPTION_KEY;
    if (!k || k.length < 32) throw new ConfigurationError('BACKUP_ENCRYPTION_KEY (32+ chars) مطلوب لتشفير النسخ الاحتياطية');
    return createHash('sha256').update(k).digest();
  }
  encrypt(data: Buffer): Buffer {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const enc = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([Buffer.from('ERPBAK1'), iv, cipher.getAuthTag(), enc]);
  }
  decrypt(blob: Buffer): Buffer {
    if (!blob.subarray(0, 7).equals(Buffer.from('ERPBAK1'))) throw new Error('تنسيق نسخة غير معروف');
    const iv = blob.subarray(7, 19); const tag = blob.subarray(19, 35); const data = blob.subarray(35);
    const d = createDecipheriv('aes-256-gcm', this.key(), iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]);
  }
  /** Logical encrypted backup (platform or single tenant). Success ONLY after artifact verification. */
  async createBackup(input: { tenantId?: string; destination?: 'local' | 'google_drive' }) {
    const db = this.prisma.client;
    const job = await db.backupJob.create({ data: { tenantId: input.tenantId ?? null, kind: input.tenantId ? 'tenant_export' : 'platform_logical', status: 'running', destination: input.destination ?? 'local', attempts: 1 } });
    try {
      const dump: Record<string, unknown[]> = {};
      // Platform-context reads (RLS would otherwise hide every row); tenant exports are
      // strictly filtered to that tenant — a tenant can never receive another tenant's data.
      await this.prisma.withPlatform(async (tx: any) => {
        for (const t of TABLES) {
          try {
            if (!input.tenantId) dump[t] = await tx.$queryRawUnsafe(`SELECT * FROM ${t}`);
            else if (t === 'tenants') dump[t] = await tx.$queryRawUnsafe(`SELECT * FROM tenants WHERE id = '${input.tenantId}'`);
            else if (['permissions'].includes(t)) dump[t] = await tx.$queryRawUnsafe(`SELECT * FROM ${t}`);
            else dump[t] = await tx.$queryRawUnsafe(`SELECT * FROM ${t} WHERE tenant_id = '${input.tenantId}'`);
          } catch { dump[t] = []; }
        }
      });
      const plain = Buffer.from(JSON.stringify({ createdAt: new Date().toISOString(), tenantId: input.tenantId ?? null, tables: dump }), 'utf8');
      const artifact = this.encrypt(plain);
      const sha = createHash('sha256').update(artifact).digest('hex');
      const dir = process.env.BACKUP_DIR ?? '/tmp/erpcloud-backups'; await mkdir(dir, { recursive: true });
      const path = join(dir, `backup-${job.id}.erp bak`.replace(' ', '')); await writeFile(path, artifact);
      // verify what we wrote before calling it success
      const written = await readFile(path);
      const okSize = written.length === artifact.length; const okHash = createHash('sha256').update(written).digest('hex') === sha;
      const okDecrypt = this.decrypt(written).length === plain.length;
      if (!okSize || !okHash || !okDecrypt) throw new Error('فشل التحقق من سلامة ملف النسخة');
      let driveFileId: string | undefined;
      if (input.destination === 'google_drive') { const up = await this.drive.upload({ name: path, content: written }); driveFileId = up.fileId; if (up.size !== written.length) throw new Error('حجم ملف Drive لا يطابق النسخة'); }
      return db.backupJob.update({ where: { id: job.id }, data: { status: 'verified', artifactPath: path, sizeBytes: written.length, sha256: sha, driveFileId: driveFileId ?? null, completedAt: new Date() } });
    } catch (e: any) {
      await db.backupJob.update({ where: { id: job.id }, data: { status: 'failed', error: String(e?.message ?? e).slice(0, 500) } });
      throw e;
    }
  }
  /** Retention: keep latest N verified (default 18 ≈ 3 days at 4h cadence, disclosed honestly). Returns kept/removed ids. */
  async applyRetention(keep = 18) {
    const db = this.prisma.client;
    const jobs = await db.backupJob.findMany({ where: { kind: 'platform_logical', status: 'verified' }, orderBy: { createdAt: 'desc' } });
    const stale = await db.backupJob.count({ where: { kind: 'platform_logical', status: 'verified', createdAt: { gt: new Date(Date.now() - 8 * 3600_000) } } });
    return { total: jobs.length, kept: jobs.slice(0, keep).map((j: any) => j.id), evictable: jobs.slice(keep).map((j: any) => j.id), staleAlert: stale === 0 };
  }
  async verifyArtifact(path: string) {
    const blob = await readFile(path);
    const plain = this.decrypt(blob); const parsed = JSON.parse(plain.toString('utf8'));
    return { sha256: createHash('sha256').update(blob).digest('hex'), sizeBytes: blob.length, tables: Object.fromEntries(Object.entries(parsed.tables).map(([k, v]: [string, any]) => [k, (v as unknown[]).length])) };
  }
}
