/** Six independent status axes (D-010) — never collapse into one field. */
export declare const COMMERCIAL_STATUS: readonly ["draft", "issued", "partially_returned", "returned", "cancelled"];
export declare const INVENTORY_STATUS: readonly ["none", "reserved", "posted", "reversed"];
export declare const ACCOUNTING_STATUS: readonly ["unposted", "posted", "reversed"];
export declare const PAYMENT_STATUS: readonly ["unpaid", "partially_paid", "paid", "credit_balance"];
export declare const TAX_STATUS: readonly ["not_required", "pending_clearance", "pending_reporting", "cleared", "reported", "rejected", "corrected"];
export declare const SYNC_STATUS: readonly ["local_only", "pending", "syncing", "synced", "rejected", "conflict"];
