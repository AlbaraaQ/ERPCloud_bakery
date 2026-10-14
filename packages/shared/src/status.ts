/** Six independent status axes (D-010) — never collapse into one field. */
export const COMMERCIAL_STATUS = ['draft','issued','partially_returned','returned','cancelled'] as const;
export const INVENTORY_STATUS = ['none','reserved','posted','reversed'] as const;
export const ACCOUNTING_STATUS = ['unposted','posted','reversed'] as const;
export const PAYMENT_STATUS = ['unpaid','partially_paid','paid','credit_balance'] as const;
export const TAX_STATUS = ['not_required','pending_clearance','pending_reporting','cleared','reported','rejected','corrected'] as const;
export const SYNC_STATUS = ['local_only','pending','syncing','synced','rejected','conflict'] as const;
