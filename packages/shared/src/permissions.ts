export const PERMISSIONS = [
  'accounting.view','accounting.journal.create','accounting.journal.post','accounting.journal.reverse',
  'accounting.period.close','accounting.period.reopen','accounting.configure',
  'sales.view','sales.create','sales.edit_draft','sales.post','sales.reverse','sales.export',
  'inventory.view','inventory.adjust','inventory.transfer.create','inventory.transfer.dispatch','inventory.transfer.receive',
  'purchasing.view','purchasing.create','purchasing.post',
  'cash.view','cash.create','cash.post','expense.approve',
  'representatives.view','representatives.manage','settlement.view','settlement.finalize','settlement.exception.approve',
  'production.view','production.manage','production.post',
  'tax.view','tax.configure','tax.submit',
  'reports.view','reports.export','parties.view','parties.manage','products.view','products.manage',
  'employees.view','employees.manage','payroll.view','payroll.manage',
  'tenant.configure','tenant.export','ai.use','platform.admin'
] as const;
export type Permission = typeof PERMISSIONS[number];
export const ROLES = ['TENANT_OWNER','ACCOUNTANT','SALES_MANAGER','WAREHOUSE_MANAGER','PRODUCTION_MANAGER','CASHIER','FIELD_REP','AUDITOR'] as const;
export type RoleCode = typeof ROLES[number];
export const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  TENANT_OWNER: [...PERMISSIONS.filter(p=>p!=='platform.admin')],
  ACCOUNTANT: ['accounting.view','accounting.journal.create','accounting.journal.post','accounting.journal.reverse','accounting.period.close','accounting.configure','sales.view','sales.post','sales.reverse','purchasing.view','purchasing.post','cash.view','cash.post','expense.approve','inventory.view','inventory.adjust','settlement.view','settlement.finalize','settlement.exception.approve','tax.view','tax.configure','tax.submit','reports.view','reports.export','parties.view','parties.manage','products.view','settlement.view','tenant.configure'],
  SALES_MANAGER: ['sales.view','sales.create','sales.edit_draft','sales.post','reports.view','parties.view','parties.manage','products.view','representatives.view'],
  WAREHOUSE_MANAGER: ['inventory.view','inventory.adjust','inventory.transfer.create','inventory.transfer.dispatch','inventory.transfer.receive','products.view','reports.view'],
  PRODUCTION_MANAGER: ['production.view','production.manage','production.post','inventory.view','products.view'],
  CASHIER: ['sales.view','sales.create','sales.edit_draft','cash.view','cash.create','parties.view'],
  FIELD_REP: ['sales.view','sales.create','sales.edit_draft','inventory.view','inventory.transfer.receive','cash.view','cash.create','parties.view','settlement.view'],
  AUDITOR: ['accounting.view','sales.view','inventory.view','purchasing.view','cash.view','reports.view','tax.view','settlement.view','parties.view','products.view','production.view'],
};
