import Decimal from 'decimal.js';
export type Money = Decimal;
export declare const money: (v: string | number | Decimal) => Decimal;
export declare const MONEY_SCALE = 4;
export declare const QTY_SCALE = 6;
export declare const qMoney: (v: Decimal) => Decimal;
export declare const qQty: (v: Decimal) => Decimal;
export declare function assertBalanced(lines: {
    debit: Decimal;
    credit: Decimal;
}[]): void;
