import { describe, it, expect } from 'vitest';
import { money, assertBalanced } from './money';
describe('money', () => {
  it('exact decimal: 0.1+0.2=0.3', () => { expect(money('0.1').plus(money('0.2')).toString()).toBe('0.3'); });
  it('balanced journal passes, unbalanced throws', () => {
    assertBalanced([{debit: money('100'), credit: money('0')},{debit: money('0'), credit: money('100')}]);
    expect(()=>assertBalanced([{debit: money('100'), credit: money('0')}])).toThrow(/Unbalanced/);
  });
});
