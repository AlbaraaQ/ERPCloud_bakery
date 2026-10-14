"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.qQty = exports.qMoney = exports.QTY_SCALE = exports.MONEY_SCALE = exports.money = void 0;
exports.assertBalanced = assertBalanced;
const decimal_js_1 = __importDefault(require("decimal.js"));
decimal_js_1.default.set({ precision: 28, rounding: decimal_js_1.default.ROUND_HALF_UP });
const money = (v) => {
    if (typeof v === 'number' && !Number.isFinite(v))
        throw new Error('Invalid money value');
    // Strings are the safe path; numbers are accepted only for integers in tests/callers that know the risk.
    return new decimal_js_1.default(v);
};
exports.money = money;
exports.MONEY_SCALE = 4;
exports.QTY_SCALE = 6;
const qMoney = (v) => v.toDecimalPlaces(exports.MONEY_SCALE);
exports.qMoney = qMoney;
const qQty = (v) => v.toDecimalPlaces(exports.QTY_SCALE);
exports.qQty = qQty;
function assertBalanced(lines) {
    const d = lines.reduce((a, l) => a.plus(l.debit), new decimal_js_1.default(0));
    const c = lines.reduce((a, l) => a.plus(l.credit), new decimal_js_1.default(0));
    if (!d.equals(c))
        throw new Error(`Unbalanced journal: debit ${d} != credit ${c}`);
    if (d.lte(0))
        throw new Error('Journal total must be positive');
}
//# sourceMappingURL=money.js.map