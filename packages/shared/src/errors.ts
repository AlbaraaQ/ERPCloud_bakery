export class DomainError extends Error { constructor(public code: string, message: string, public httpStatus = 400){ super(message); } }
export class ConfigurationError extends DomainError { constructor(m:string){ super('CONFIGURATION_ERROR', m, 422); } }
export class InsufficientStockError extends DomainError { constructor(m='Insufficient available stock / لا توجد كمية متاحة كافية'){ super('INSUFFICIENT_STOCK', m, 422); } }
export class PeriodClosedError extends DomainError { constructor(m='Accounting period is closed / الفترة المحاسبية مغلقة'){ super('PERIOD_CLOSED', m, 422); } }
export class ForbiddenError extends DomainError { constructor(m='Forbidden / غير مصرح'){ super('FORBIDDEN', m, 403); } }
export class ConflictError extends DomainError { constructor(m:string){ super('CONFLICT', m, 409); } }
