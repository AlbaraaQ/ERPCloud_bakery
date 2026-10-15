import { describe, it, expect } from 'vitest';
import { checkPrice, lineAmounts } from './pricing';
describe('pricing (AT-PRICE)', () => {
  it('customer/resolved price used by default', () => { const r = checkPrice({ resolvedPrice: '10' }); expect(r.requested.toString()).toBe('10'); expect(r.isOverride).toBe(false); });
  it('below min is out of bounds override', () => { const r = checkPrice({ resolvedPrice: '10', minPrice: '9', requestedPrice: '8' }); expect(r.outOfBounds).toBe(true); expect(r.belowMin).toBe(true); });
  it('line tax: 100 @15% = 15 tax, 115 total', () => { const a = lineAmounts('1','100','0','15'); expect(a.tax.toString()).toBe('15'); expect(a.total.toString()).toBe('115'); });
});
