import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, hashToken, newToken } from './password';
describe('password & tokens', () => {
  it('argon2id verifies correct and rejects wrong', async () => {
    const h = await hashPassword('Strong-Pass-123!');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'Strong-Pass-123!')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
  });
  it('tokens are unique and only hashes are stored', () => { const a=newToken(), b=newToken(); expect(a).not.toBe(b); expect(hashToken(a)).toHaveLength(64); expect(hashToken(a)).not.toContain(a); });
});
