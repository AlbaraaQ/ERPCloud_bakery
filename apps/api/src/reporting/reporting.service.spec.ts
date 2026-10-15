import { describe, it, expect } from 'vitest';
import { toCsv } from './reporting.service';
describe('csv export', () => {
  it('quotes and escapes', () => { expect(toCsv([{ a: 'x,y', b: 'ق"يد' }])).toBe('a,b\n"x,y","ق""يد"'); });
  it('empty rows -> empty string', () => { expect(toCsv([])).toBe(''); });
});
