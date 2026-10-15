import { Injectable } from '@nestjs/common';
import { ConfigurationError } from '@erpcloud/shared';
export interface ZatcaSubmitResult { accepted: boolean; status: 'cleared' | 'reported' | 'rejected'; reference?: string; responseCode?: string; stamp?: string; }
export interface ZatcaGateway {
  submit(input: { environment: string; kind: string; xml: string; hash: string; uuid: string; secretRef: string }): Promise<ZatcaSubmitResult>;
}
/**
 * HTTP gateway. Endpoints are NOT hard-coded from memory: base URL and the clearance /
 * reporting paths come from environment configuration that must be filled from the
 * current official ZATCA developer documentation at onboarding (Q-001). Missing config
 * blocks submission with an actionable error — nothing is faked.
 */
@Injectable()
export class HttpZatcaGateway implements ZatcaGateway {
  async submit(input: { environment: string; kind: string; xml: string; hash: string; uuid: string; secretRef: string }): Promise<ZatcaSubmitResult> {
    const base = process.env.ZATCA_BASE_URL;
    const clearancePath = process.env.ZATCA_CLEARANCE_PATH;
    const reportingPath = process.env.ZATCA_REPORTING_PATH;
    if (!base || !clearancePath || !reportingPath) throw new ConfigurationError('بوابة ZATCA غير مُكوَّنة: ZATCA_BASE_URL / ZATCA_CLEARANCE_PATH / ZATCA_REPORTING_PATH مطلوبة من وثائق ZATCA الرسمية الحالية');
    const isClearance = input.kind.startsWith('standard');
    const url = base.replace(/\/$/, '') + (isClearance ? clearancePath : reportingPath);
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-secret-ref': input.secretRef }, body: JSON.stringify({ invoiceHash: input.hash, uuid: input.uuid, invoice: Buffer.from(input.xml, 'utf8').toString('base64') }) });
    } catch (e) {
      throw new Error(`ZATCA network error: ${(e as Error).message}`);
    }
    const body = await res.json().catch(() => ({})) as any;
    if (res.status >= 200 && res.status < 300) return { accepted: true, status: isClearance ? 'cleared' : 'reported', reference: body.clearanceInvoiceReference ?? body.reportingInvoiceReference ?? body.invoiceReference, responseCode: String(res.status), stamp: body.clearedInvoiceStamp ?? body.cryptoStamp };
    return { accepted: false, status: 'rejected', responseCode: String(res.status), reference: body?.message };
  }
}
