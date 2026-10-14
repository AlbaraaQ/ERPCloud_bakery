import { describe, it, expect } from 'vitest';
import { stableHash } from './sync.service';
describe('sync payload hash', () => {
  it('key order independent, value sensitive', () => {
    expect(stableHash({ a: 1, b: { c: 2, d: 3 } })).toBe(stableHash({ b: { d: 3, c: 2 }, a: 1 }));
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });
});
