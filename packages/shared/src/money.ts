import Decimal from 'decimal.js';
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });
export type Money = Decimal;
export const money = (v: string | number | Decimal): Decimal => {
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('Invalid money value');
  // Strings are the safe path; numbers are accepted only for integers in tests/callers that know the risk.
  return new Decimal(v as never);
};
export const MONEY_SCALE = 4;
export const QTY_SCALE = 6;
export const qMoney = (v: Decimal): Decimal => v.toDecimalPlaces(MONEY_SCALE);
export const qQty = (v: Decimal): Decimal => v.toDecimalPlaces(QTY_SCALE);
export function assertBalanced(lines: { debit: Decimal; credit: Decimal }[]): void {
  const d = lines.reduce((a, l) => a.plus(l.debit), new Decimal(0));
  const c = lines.reduce((a, l) => a.plus(l.credit), new Decimal(0));
  if (!d.equals(c)) throw new Error(`Unbalanced journal: debit ${d} != credit ${c}`);
  if (d.lte(0)) throw new Error('Journal total must be positive');
}
