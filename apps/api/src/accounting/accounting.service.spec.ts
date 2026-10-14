import { describe, it, expect } from 'vitest';
import { validateLines } from './accounting.service';
const A='00000000-0000-0000-0000-000000000001', B='00000000-0000-0000-0000-000000000002';
describe('journal validation (AT-ACC-001 pure rules)', () => {
  it('accepts balanced', () => validateLines([{accountId:A,debit:'100.0000',credit:'0'},{accountId:B,debit:'0',credit:'100.0000'}]));
  it('rejects unbalanced', () => expect(()=>validateLines([{accountId:A,debit:'100',credit:'0'},{accountId:B,debit:'0',credit:'90'}])).toThrow(/Unbalanced/));
  it('rejects line with both sides', () => expect(()=>validateLines([{accountId:A,debit:'5',credit:'5'},{accountId:B,debit:'0',credit:'5'}])).toThrow());
  it('rejects single line', () => expect(()=>validateLines([{accountId:A,debit:'5',credit:'0'}])).toThrow());
});
