import { describe, it, expect } from 'vitest';
import { RateLimiter, passwordPolicy } from './security';
describe('security hardening', () => {
  it('rate limiter blocks after limit within window', () => { const rl = new RateLimiter(3, 60_000); expect(rl.allow('k', 0)).toBe(true); expect(rl.allow('k', 1)).toBe(true); expect(rl.allow('k', 2)).toBe(true); expect(rl.allow('k', 3)).toBe(false); expect(rl.allow('k', 70_000)).toBe(true); });
  it('password policy', () => { expect(passwordPolicy('short1')).toBeTruthy(); expect(passwordPolicy('onlyletters-long')).toBeTruthy(); expect(passwordPolicy('Strong-Pass-123')).toBeNull(); });
});
