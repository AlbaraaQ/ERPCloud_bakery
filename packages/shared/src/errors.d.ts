export declare class DomainError extends Error {
    code: string;
    httpStatus: number;
    constructor(code: string, message: string, httpStatus?: number);
}
export declare class ConfigurationError extends DomainError {
    constructor(m: string);
}
export declare class InsufficientStockError extends DomainError {
    constructor(m?: string);
}
export declare class PeriodClosedError extends DomainError {
    constructor(m?: string);
}
export declare class ForbiddenError extends DomainError {
    constructor(m?: string);
}
export declare class ConflictError extends DomainError {
    constructor(m: string);
}
