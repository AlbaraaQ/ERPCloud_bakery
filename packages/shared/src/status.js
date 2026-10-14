"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SYNC_STATUS = exports.TAX_STATUS = exports.PAYMENT_STATUS = exports.ACCOUNTING_STATUS = exports.INVENTORY_STATUS = exports.COMMERCIAL_STATUS = void 0;
/** Six independent status axes (D-010) — never collapse into one field. */
exports.COMMERCIAL_STATUS = ['draft', 'issued', 'partially_returned', 'returned', 'cancelled'];
exports.INVENTORY_STATUS = ['none', 'reserved', 'posted', 'reversed'];
exports.ACCOUNTING_STATUS = ['unposted', 'posted', 'reversed'];
exports.PAYMENT_STATUS = ['unpaid', 'partially_paid', 'paid', 'credit_balance'];
exports.TAX_STATUS = ['not_required', 'pending_clearance', 'pending_reporting', 'cleared', 'reported', 'rejected', 'corrected'];
exports.SYNC_STATUS = ['local_only', 'pending', 'syncing', 'synced', 'rejected', 'conflict'];
//# sourceMappingURL=status.js.map