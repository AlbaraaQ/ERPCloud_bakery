"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConflictError = exports.ForbiddenError = exports.PeriodClosedError = exports.InsufficientStockError = exports.ConfigurationError = exports.DomainError = void 0;
class DomainError extends Error {
    code;
    httpStatus;
    constructor(code, message, httpStatus = 400) {
        super(message);
        this.code = code;
        this.httpStatus = httpStatus;
    }
}
exports.DomainError = DomainError;
class ConfigurationError extends DomainError {
    constructor(m) { super('CONFIGURATION_ERROR', m, 422); }
}
exports.ConfigurationError = ConfigurationError;
class InsufficientStockError extends DomainError {
    constructor(m = 'Insufficient available stock / لا توجد كمية متاحة كافية') { super('INSUFFICIENT_STOCK', m, 422); }
}
exports.InsufficientStockError = InsufficientStockError;
class PeriodClosedError extends DomainError {
    constructor(m = 'Accounting period is closed / الفترة المحاسبية مغلقة') { super('PERIOD_CLOSED', m, 422); }
}
exports.PeriodClosedError = PeriodClosedError;
class ForbiddenError extends DomainError {
    constructor(m = 'Forbidden / غير مصرح') { super('FORBIDDEN', m, 403); }
}
exports.ForbiddenError = ForbiddenError;
class ConflictError extends DomainError {
    constructor(m) { super('CONFLICT', m, 409); }
}
exports.ConflictError = ConflictError;
//# sourceMappingURL=errors.js.map