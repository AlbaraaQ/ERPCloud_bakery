import { describe, it, expect } from 'vitest';
import { hasPermissions } from './permissions.guard';
import { ROLE_PERMISSIONS } from '@erpcloud/shared';
describe('RBAC matrix skeleton (AT-SEC-002)', () => {
  it('auditor is read-only: cannot post sales', () => { expect(hasPermissions(ROLE_PERMISSIONS.AUDITOR, ['sales.post'])).toBe(false); });
  it('field rep can create but not post/finalize settlement', () => {
    expect(hasPermissions(ROLE_PERMISSIONS.FIELD_REP, ['sales.create'])).toBe(true);
    expect(hasPermissions(ROLE_PERMISSIONS.FIELD_REP, ['settlement.finalize'])).toBe(false);
  });
  it('accountant can finalize settlement', () => { expect(hasPermissions(ROLE_PERMISSIONS.ACCOUNTANT, ['settlement.finalize'])).toBe(true); });
});
