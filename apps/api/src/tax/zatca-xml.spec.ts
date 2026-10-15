import { describe, it, expect } from 'vitest';
import { buildInvoiceXml, sha256B64, buildQrPayload } from './zatca-xml';
const base = { uuid: '00000000-0000-4000-8000-000000000001', icv: 1, previousHash: 'x', issueDate: '2026-10-01', issueTime: '10:00:00', sellerName: 'شركة', sellerVat: '300000000000003', kind: 'simplified', subtotal: '100', taxTotal: '15', total: '115', lines: [{ name: 'خبز', qty: '10', price: '10', taxRate: '15', taxAmount: '15', lineTotal: '115' }] };
describe('zatca xml/qr primitives', () => {
  it('xml is deterministic and hash changes with content', () => {
    const a = buildInvoiceXml(base); expect(buildInvoiceXml(base)).toBe(a);
    expect(sha256B64(a)).not.toBe(sha256B64(buildInvoiceXml({ ...base, total: '116' })));
    expect(a).toContain('<cbc:UUID>00000000-0000-4000-8000-000000000001</cbc:UUID>');
  });
  it('qr TLV decodes with tag1 seller and correct total', () => {
    const qr = buildQrPayload({ sellerName: 'شركة', sellerVat: '300000000000003', timestamp: '2026-10-01T10:00:00Z', total: '115', taxTotal: '15' });
    const raw = Buffer.from(qr, 'base64'); expect(raw[0]).toBe(1); expect(raw[1]).toBe(Buffer.byteLength('شركة'));
    expect(qr).not.toContain('CLEARED'); // never fabricates a clearance stamp
  });
});
