import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigurationError, DomainError, money } from '@erpcloud/shared';
import { PrismaService } from '../prisma/prisma.service';
import { buildInvoiceXml, sha256B64, buildQrPayload } from './zatca-xml';
import { HttpZatcaGateway, type ZatcaGateway } from './zatca.gateway';

@Injectable()
export class TaxService {
  constructor(private prisma: PrismaService, private gateway: HttpZatcaGateway) {}

  async configure(tenantId: string, input: { vatRegistered: boolean; vatNumber?: string }) {
    if (input.vatRegistered && !input.vatNumber) throw new ConfigurationError('الرقم الضريبي مطلوب عند التسجيل في ضريبة القيمة المضافة');
    return this.prisma.withTenant(tenantId, (tx: any) => tx.tenant.update({ where: { id: tenantId }, data: { vatRegistered: input.vatRegistered, vatNumber: input.vatNumber ?? null } }));
  }
  async registerCredential(tenantId: string, input: { environment: string; secretRef: string }) {
    if (!/^[A-Z0-9_\-:/]+$/i.test(input.secretRef)) throw new ConfigurationError('secretRef يجب أن يكون اسم مرجع في مخزن الأسرار — لا تضع السر نفسه أبداً');
    return this.prisma.withTenant(tenantId, (tx: any) => tx.zatcaCredential.upsert({ where: { tenantId_environment: { tenantId, environment: input.environment } }, create: { tenantId, environment: input.environment, secretRef: input.secretRef }, update: { secretRef: input.secretRef, status: 'configured' } }));
  }

  /**
   * Submits a posted sales invoice: buyer with VAT number -> standard (clearance),
   * otherwise simplified (reporting). Idempotent: accepted submissions return as-is;
   * retries reuse the SAME uuid/icv/hash/xml (never a duplicate issuance).
   * Network failure -> status 'failed' (retryable); official rejection -> 'rejected'.
   * Acceptance is recorded ONLY from a real gateway response — never fabricated.
   */
  async submitInvoice(tenantId: string, invoiceId: string, opts: { environment?: string } = {}) {
    const environment = opts.environment ?? 'sandbox';
    const prepared = await this.prisma.withTenant(tenantId, async (tx: any) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      const invoice = await tx.salesInvoice.findUnique({ where: { id: invoiceId }, include: { lines: true } });
      if (!invoice || invoice.accountingStatus !== 'posted') throw new DomainError('INVALID_TAX_SUBMIT', 'الإرسال الضريبي يتطلب فاتورة مرحّلة');
      if (!tenant.vatRegistered) { await tx.salesInvoice.update({ where: { id: invoiceId }, data: { taxStatus: 'not_required' } }); return { notRequired: true as const }; }
      if (!tenant.vatNumber) throw new ConfigurationError('الرقم الضريبي للبائع غير مُكوَّن');
      const cred = await tx.zatcaCredential.findUnique({ where: { tenantId_environment: { tenantId, environment } } });
      if (!cred || cred.status !== 'configured') throw new ConfigurationError(`بيانات اعتماد ZATCA لبيئة ${environment} غير مُكوَّنة`);
      const existing = await tx.taxSubmission.findUnique({ where: { tenantId_documentType_documentId_environment: { tenantId, documentType: 'sales_invoice', documentId: invoiceId, environment } } });
      if (existing && (existing.status === 'cleared' || existing.status === 'reported')) return { done: existing };
      if (existing) return { sub: existing, secretRef: cred.secretRef };
      const party = invoice.partyId ? await tx.party.findUnique({ where: { id: invoice.partyId } }) : null;
      const kind = party?.taxNumber ? 'standard' : 'simplified';
      await tx.taxCounter.upsert({ where: { tenantId_environment: { tenantId, environment } }, create: { tenantId, environment, lastIcv: 0 }, update: {} });
      const rows = await tx.$queryRaw`UPDATE tax_counters SET last_icv = last_icv + 1 WHERE tenant_id = ${tenantId}::uuid AND environment = ${environment} RETURNING last_icv, last_hash`;
      const icv = rows[0].last_icv as number; const previousHash = rows[0].last_hash ?? sha256B64('0');
      const uuid = randomUUID();
      const lines = await Promise.all(invoice.lines.map(async (l: any) => { const prod = await tx.product.findUnique({ where: { id: l.productId } }); return { name: prod?.nameAr ?? 'item', qty: l.qty.toString(), price: l.unitPrice.toString(), taxRate: l.taxRate.toString(), taxAmount: l.taxAmount.toString(), lineTotal: l.lineTotal.toString() }; }));
      const issue = invoice.businessDate.toISOString();
      const xml = buildInvoiceXml({ uuid, icv, previousHash, issueDate: issue.slice(0, 10), issueTime: issue.slice(11, 19), sellerName: tenant.name, sellerVat: tenant.vatNumber, buyerVat: party?.taxNumber ?? undefined, kind, subtotal: money(invoice.total.toString()).minus(money(invoice.taxTotal.toString())).toString(), taxTotal: invoice.taxTotal.toString(), total: invoice.total.toString(), lines });
      const hash = sha256B64(xml);
      const qr = kind === 'simplified' ? buildQrPayload({ sellerName: tenant.name, sellerVat: tenant.vatNumber, timestamp: issue, total: invoice.total.toString(), taxTotal: invoice.taxTotal.toString() }) : null;
      const sub = await tx.taxSubmission.create({ data: { tenantId, documentType: 'sales_invoice', documentId: invoiceId, kind, environment, uuid, icv, previousHash, invoiceHash: hash, xmlHash: hash, xml, qrPayload: qr } });
      await tx.taxCounter.update({ where: { tenantId_environment: { tenantId, environment } }, data: { lastHash: hash } });
      await tx.salesInvoice.update({ where: { id: invoiceId }, data: { taxStatus: kind === 'standard' ? 'pending_clearance' : 'pending_reporting' } });
      return { sub, secretRef: cred.secretRef };
    });
    if ((prepared as any).notRequired) return { status: 'not_required' };
    if ((prepared as any).done) return (prepared as any).done;
    const { sub, secretRef } = prepared as any;
    let outcome: { status: string; submissionRef?: string; responseCode?: string; stamp?: string };
    try {
      const r = await this.gateway.submit({ environment, kind: sub.kind, xml: sub.xml, hash: sub.invoiceHash, uuid: sub.uuid, secretRef });
      outcome = r.accepted ? { status: r.status, submissionRef: r.reference, responseCode: r.responseCode, stamp: r.stamp } : { status: 'rejected', submissionRef: r.reference, responseCode: r.responseCode };
    } catch (e: any) {
      outcome = { status: 'failed' };
      await this.prisma.withTenant(tenantId, async (tx: any) => {
        await tx.taxSubmission.update({ where: { id: sub.id }, data: { status: 'failed', attempts: sub.attempts + 1, lastError: String(e?.message ?? e).slice(0, 500) } });
      });
      return this.prisma.withTenant(tenantId, (tx: any) => tx.taxSubmission.findUnique({ where: { id: sub.id } }));
    }
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const updated = await tx.taxSubmission.update({ where: { id: sub.id }, data: { status: outcome.status, submissionRef: outcome.submissionRef ?? null, responseCode: outcome.responseCode ?? null, attempts: sub.attempts + 1, lastError: outcome.status === 'rejected' ? (outcome.submissionRef ?? 'rejected') : null } });
      await tx.salesInvoice.update({ where: { id: invoiceId }, data: { taxStatus: outcome.status === 'cleared' ? 'cleared' : outcome.status === 'reported' ? 'reported' : outcome.status === 'rejected' ? 'rejected' : sub.kind === 'standard' ? 'pending_clearance' : 'pending_reporting' } });
      await tx.auditLog.create({ data: { tenantId, action: `tax.${outcome.status}`, entityType: 'sales_invoice', entityId: invoiceId, after: { submissionId: sub.id, icv: sub.icv, environment } } });
      return updated;
    });
  }

  async listSubmissions(tenantId: string, environment = 'sandbox') {
    return this.prisma.withTenant(tenantId, (tx: any) => tx.taxSubmission.findMany({ where: { tenantId, environment }, orderBy: { createdAt: 'desc' }, take: 200 }));
  }
  async periodSummary(tenantId: string, from: string, to: string) {
    return this.prisma.withTenant(tenantId, async (tx: any) => {
      const lines = await tx.salesLine.findMany({ where: { tenantId, invoice: { accountingStatus: 'posted', businessDate: { gte: new Date(from), lte: new Date(to) } } } });
      const byRate = new Map<string, { net: ReturnType<typeof money>; tax: ReturnType<typeof money> }>();
      for (const l of lines) { const k = l.taxRate.toString(); const cur = byRate.get(k) ?? { net: money(0), tax: money(0) }; cur.net = cur.net.plus(money(l.lineTotal.toString()).minus(money(l.taxAmount.toString()))); cur.tax = cur.tax.plus(money(l.taxAmount.toString())); byRate.set(k, cur); }
      return [...byRate.entries()].map(([rate, v]) => ({ rate, net: v.net.toString(), tax: v.tax.toString() }));
    });
  }
}
