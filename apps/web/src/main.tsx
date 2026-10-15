import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t, type Lang } from './i18n';
import { countByState, syncNow, enqueue } from './offline';
import './styles.css';

async function api(path: string, body?: unknown): Promise<any> {
  const r = await fetch('/api/v1' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  if (!r.ok) throw new Error((data && (data.message || data.error)) || text || ('HTTP ' + r.status));
  return data;
}
const key = () => 'web-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
const today = () => new Date().toISOString().slice(0, 10);
const fmt = (v: any) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

const LABELS: Record<string, string> = {
  code: 'الرمز', name: 'الاسم', nameAr: 'الاسم', nameEn: 'الاسم الإنجليزي', sku: 'رمز المنتج', barcode: 'الباركود',
  type: 'النوع', kind: 'النوع', status: 'الحالة', isActive: 'مفعّل', email: 'البريد الإلكتروني', displayName: 'اسم المستخدم',
  phone: 'الهاتف', taxNumber: 'الرقم الضريبي', creditLimit: 'حد الائتمان', creditHold: 'إيقاف ائتماني',
  qty: 'الكمية', value: 'القيمة', avgCost: 'متوسط التكلفة', unitCost: 'تكلفة الوحدة', unitPrice: 'سعر الوحدة',
  defaultPrice: 'سعر البيع', minPrice: 'أدنى سعر', maxPrice: 'أعلى سعر', taxRate: 'الضريبة %', taxCategory: 'فئة الضريبة',
  total: 'الإجمالي', subtotal: 'قبل الضريبة', taxTotal: 'الضريبة', discountTotal: 'الخصم', paidAmount: 'المدفوع',
  debit: 'مدين', credit: 'دائن', balance: 'الرصيد', amount: 'المبلغ', category: 'التصنيف', description: 'البيان',
  number: 'الرقم', version: 'الإصدار', lines: 'عدد السطور', periods: 'عدد الفترات', roles: 'الأدوار',
  businessDate: 'التاريخ', startDate: 'من', endDate: 'إلى', createdAt: 'أُنشئ في', periodStart: 'بداية الفترة', periodEnd: 'نهاية الفترة',
  expectedCash: 'النقد المتوقع', countedCash: 'النقد المعدود', fullName: 'اسم الموظف', purpose: 'الغرض المحاسبي', account: 'الحساب',
  accountingStatus: 'الحالة المحاسبية', paymentStatus: 'حالة الدفع', taxStatus: 'الحالة الضريبية', commercialStatus: 'الحالة التجارية',
  inventoryStatus: 'حالة المخزون', costingMethod: 'طريقة التكلفة', lotTracked: 'تتبع تشغيلات', expiryTracked: 'تتبع صلاحية',
  product: 'المنتج', warehouse: 'المخزن', price: 'السعر', lineTotal: 'إجمالي السطر', freeQty: 'مجاني',
};
const STATUS_AR: Record<string, string> = {
  posted: 'مرحّلة', unposted: 'غير مرحّلة', draft: 'مسودة', paid: 'مدفوعة', unpaid: 'غير مدفوعة', partial: 'مدفوعة جزئياً',
  received: 'مستلمة', dispatched: 'مُرسلة', partially_received: 'مستلمة جزئياً', disputed: 'متنازع عليها', closed: 'مغلقة',
  requested: 'مطلوبة', under_review: 'قيد المراجعة', finalized: 'نهائية', failed: 'فاشلة', rejected: 'مرفوضة',
  not_required: 'غير خاضعة', pending: 'قيد الانتظار', reported: 'مُبلّغة', cleared: 'مقبولة من الهيئة', synced: 'متزامنة',
  active: 'نشط', open: 'مفتوحة', approved: 'معتمدة',
};
const moneyKeys = /(total|amount|price|cost|balance|debit|credit|value|paid|limit)/i;
function fmtCell(col: string, v: any): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
  if (col === 'taxRate') return String(v) + '%';
  if (/date|Date|createdAt/.test(col) && typeof v === 'string' && v.length >= 10) return v.slice(0, 10);
  if (typeof v === 'string' && STATUS_AR[v]) return STATUS_AR[v];
  if (moneyKeys.test(col) && v !== '' && !isNaN(Number(v))) return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && v.length < 16) return Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
  return fmt(v);
}
function Table({ rows }: { rows: any[] }) {
  if (!rows?.length) return <p className="muted">لا توجد بيانات بعد — أضف أول عنصر من النموذج أعلاه.</p>;
  const cols = Object.keys(rows[0]).filter(c => c !== 'id' && !c.endsWith('Id') && (typeof rows[0][c] !== 'object' || rows[0][c] === null)).slice(0, 9);
  return <div className="tablewrap"><table><thead><tr>{cols.map(c => <th key={c}>{LABELS[c] ?? c}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={r.id ?? i}>{cols.map(c => <td key={c}>{fmtCell(c, r[c])}</td>)}</tr>)}</tbody></table></div>;
}
export const statusAr = (v: string) => STATUS_AR[v] ?? v;
/** Generic renderer for report JSON (objects of scalars / arrays of rows). */
function ReportView({ data }: { data: any }) {
  if (!data) return null;
  if (Array.isArray(data)) return <Table rows={data} />;
  const scalars = Object.entries(data).filter(([, v]) => typeof v !== 'object' || v === null);
  const arrays = Object.entries(data).filter(([, v]) => Array.isArray(v)) as [string, any[]][];
  const objects = Object.entries(data).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v)) as [string, any][];
  return <div>{scalars.length > 0 && <Table rows={[Object.fromEntries(scalars)]} />}
    {arrays.map(([k, v]) => <div key={k}><h4>{k}</h4><Table rows={v} /></div>)}
    {objects.map(([k, v]) => <div key={k}><h4>{k}</h4><ReportView data={v} /></div>)}</div>;
}

type Master = { accounts: any[]; products: any[]; warehouses: any[]; parties: any[]; units: any[]; cashAccounts: any[]; employees: any[]; mappings: any[]; fiscalYears: any[] };
const emptyMaster: Master = { accounts: [], products: [], warehouses: [], parties: [], units: [], cashAccounts: [], employees: [], mappings: [], fiscalYears: [] };

function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [lang, setLang] = useState<Lang>('ar');
  const [health, setHealth] = useState('…');
  const [form, setForm] = useState({ tenantSlug: 'demo', email: '', password: '' });
  const [user, setUser] = useState<any>(null);
  const [page, setPage] = useState('dashboard');
  const [dash, setDash] = useState<any>(null);
  const [master, setMaster] = useState<Master>(emptyMaster);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [syncCounts, setSyncCounts] = useState<Record<string, number>>({});
  const s = t[lang]; const ar = lang === 'ar';
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = ar ? 'rtl' : 'ltr'; }, [lang, ar]);
  useEffect(() => { fetch('/api/v1/health').then(r => r.json()).then(d => setHealth(d.status)).catch(() => setHealth('offline')); countByState().then(setSyncCounts).catch(() => {}); }, []);

  async function loadMaster() {
    const [accounts, products, warehouses, parties, units, cashAccounts, employees, mappings, fiscalYears] = await Promise.all([
      api('/master/accounts', {}), api('/master/products', {}), api('/master/warehouses', {}), api('/master/parties', {}),
      api('/master/units', {}), api('/master/cash-accounts', {}), api('/master/employees', {}), api('/master/mappings', {}), api('/master/fiscal-years', {})]);
    setMaster({ accounts, products, warehouses, parties, units, cashAccounts, employees, mappings, fiscalYears });
  }
  async function login(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    try { const u = await api('/auth/login', form); setUser(u); setDash(await api('/reports/dashboard')); await loadMaster(); }
    catch (ex: any) { setErr('فشل تسجيل الدخول: ' + ex.message); }
  }
  async function logout() { try { await api('/auth/logout'); } catch { /* ignore */ } setUser(null); }
  const run = async (fn: () => Promise<any>, okMsg = 'تم الحفظ بنجاح') => {
    setErr(''); setMsg('');
    try { const r = await fn(); setMsg(okMsg); await loadMaster().catch(() => {}); return r; }
    catch (ex: any) { setErr(ex.message); throw ex; }
  };
  const nav: [string, string][] = [['dashboard', s.dashboard], ['sales', s.sales], ['purchases', ar ? 'المشتريات' : 'Purchases'], ['cash', ar ? 'الخزينة والمصروفات' : 'Cash & Expenses'], ['parties', ar ? 'العملاء والموردون' : 'Customers & Suppliers'], ['inventory', s.inventory], ['accounting', s.accounting], ['production', ar ? 'التصنيع' : 'Manufacturing'], ['reps', s.reps], ['reports', s.reports], ['settings', s.settings]];
  const setupDone = { accounts: master.accounts.length > 0, mappings: master.mappings.length >= 8, fy: master.fiscalYears.length > 0, products: master.products.length > 0, warehouses: master.warehouses.length > 0 };

  return (<div className="layout">
    <aside><div className="logo">☁️ {s.app}</div>
      {nav.map(([k, label]) => <a key={k} className={page === k ? 'active' : ''} href="#" onClick={e => { e.preventDefault(); setPage(k); }}>{label}</a>)}
      <div className="muted small">🔄 {ar ? 'المزامنة' : 'Sync'}: {Object.entries(syncCounts).map(([k, v]) => `${k}:${v}`).join(' · ') || '—'}</div>
      {user && <button onClick={logout}>{s.logout}</button>}
    </aside>
    <main>
      <header><span>{s.health}: <b>{health === 'ok' ? 'متصل ✅' : health}</b></span>{user && <span className="muted">👤 {user.user?.displayName} — {form.tenantSlug}</span>}<span className="spacer" />
        <button onClick={() => setLang(ar ? 'en' : 'ar')}>{ar ? 'English' : 'العربية'}</button>
        <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? '🌙' : '☀️'} {s.toggleTheme}</button>
      </header>
      {err && <p className="error" role="alert">⚠️ {err}</p>}
      {msg && <p className="success" role="status">✅ {msg}</p>}
      {!user ? <section className="card"><h1>{s.login}</h1>
        <form onSubmit={login} className="login">
          <label>{s.tenant}<input value={form.tenantSlug} onChange={e => setForm({ ...form, tenantSlug: e.target.value })} /></label>
          <label>{s.email}<input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
          <label>{s.password}<input type="password" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
          <button type="submit">{s.login}</button></form>
        <p className="muted">أول مرة؟ أنشئ أول شركة من الخادم (seed) ثم سجّل دخول — وبعدها أكمل «معالج الإعداد» من صفحة الإعدادات: سنة مالية ← دليل حسابات ← ربط محاسبي ← منتجات ومخازن.</p></section>
      : <>
        {page === 'dashboard' && <Dashboard dash={dash} setDash={setDash} setupDone={setupDone} setPage={setPage} ar={ar} run={run} />}
        {page === 'sales' && <SalesPage m={master} run={run} ar={ar} />}
        {page === 'purchases' && <PurchasesPage m={master} run={run} />}
        {page === 'cash' && <CashPage m={master} run={run} />}
        {page === 'parties' && <PartiesPage m={master} run={run} />}
        {page === 'inventory' && <InventoryPage m={master} run={run} />}
        {page === 'accounting' && <AccountingPage m={master} run={run} />}
        {page === 'production' && <ProductionPage m={master} run={run} />}
        {page === 'reps' && <RepsPage m={master} run={run} />}
        {page === 'reports' && <ReportsPage run={run} />}
        {page === 'settings' && <SettingsPage m={master} run={run} setupDone={setupDone} />}
      </>}
    </main></div>);
}

function Dashboard({ dash, setDash, setupDone, setPage, ar, run }: any) {
  const [question, setQuestion] = useState(''); const [answer, setAnswer] = useState<any>(null);
  useEffect(() => { api('/reports/dashboard').then(setDash).catch(() => {}); }, []);
  const labels: Record<string, string> = { salesToday: 'مبيعات اليوم (ر.س)', salesThisMonth: 'مبيعات هذا الشهر (ر.س)', invoicesCount: 'عدد الفواتير', customersCount: 'العملاء', productsCount: 'المنتجات النشطة', openSettlements: 'تسويات مفتوحة', failedTaxSubmissions: 'إرسالات ضريبية فاشلة', rejectedSyncOps: 'عمليات مزامنة مرفوضة', lowStockRows: 'أصناف منخفضة المخزون', pendingTransfers: 'تحويلات بالطريق' };
  const cards: [string, any][] = dash ? Object.entries(dash).map(([k, v]) => [labels[k] ?? k, v]) : [];
  return <>
    <section className="card"><h1>لوحة التحكم</h1>
      <div className="grid">{cards.map(([k, v]) => <div className="stat" key={k}><b>{fmt(v)}</b><span>{k}</span></div>)}</div>
      <h3>معالج الإعداد الأولى — حالة شركتك</h3>
      <ul className="checklist">
        <li>{setupDone.fy ? '✅' : '⬜'} سنة مالية وفترات مفتوحة <button onClick={() => setPage('settings')}>إعداد</button></li>
        <li>{setupDone.accounts ? '✅' : '⬜'} دليل الحسابات <button onClick={() => setPage('accounting')}>إعداد</button></li>
        <li>{setupDone.mappings ? '✅' : '⬜'} الربط المحاسبي (مبيعات/مخزون/ضريبة/ذمم) <button onClick={() => setPage('settings')}>إعداد</button></li>
        <li>{setupDone.products ? '✅' : '⬜'} المنتجات والوحدات <button onClick={() => setPage('inventory')}>إعداد</button></li>
        <li>{setupDone.warehouses ? '✅' : '⬜'} المخازن <button onClick={() => setPage('inventory')}>إعداد</button></li>
      </ul></section>
    <section className="card"><h2>🤖 المساعد الذكي</h2>
      <div className="row"><input placeholder="مثال: ما هي مبيعات هذا الشهر؟" value={question} onChange={e => setQuestion(e.target.value)} />
        <button onClick={async () => { try { setAnswer(await api('/ai/ask', { question })); } catch (e: any) { setAnswer({ error: e.message }); } }}>اسأل</button></div>
      {answer && <ReportView data={answer} />}
      <p className="muted">الأرقام من التقارير الرسمية؛ الإجراءات الحساسة تتطلب اعتماداً بشرياً.</p></section>
  </>;
}

function LineEditor({ m, lines, setLines, withCost }: any) {
  const upd = (i: number, f: string, v: string) => setLines(lines.map((l: any, j: number) => j === i ? { ...l, [f]: v } : l));
  return <div>{lines.map((l: any, i: number) => <div className="row" key={i}>
    <select value={l.productId} onChange={e => upd(i, 'productId', e.target.value)}><option value="">اختر منتجاً…</option>{m.products.map((p: any) => <option key={p.id} value={p.id}>{p.sku} — {p.nameAr}</option>)}</select>
    <input placeholder="الكمية" value={l.qty} onChange={e => upd(i, 'qty', e.target.value)} />
    {withCost && <input placeholder="تكلفة الوحدة" value={l.unitCost ?? ''} onChange={e => upd(i, 'unitCost', e.target.value)} />}
    {!withCost && <input placeholder="كمية مجانية" value={l.freeQty ?? ''} onChange={e => upd(i, 'freeQty', e.target.value)} />}
    <button type="button" onClick={() => setLines(lines.filter((_: any, j: number) => j !== i))}>✖</button></div>)}
    <button type="button" onClick={() => setLines([...lines, { productId: '', qty: '1' }])}>+ سطر منتج</button></div>;
}

function SalesPage({ m, run }: any) {
  const [partyId, setPartyId] = useState(''); const [warehouseId, setWarehouseId] = useState('');
  const [date, setDate] = useState(today()); const [lines, setLines] = useState<any[]>([{ productId: '', qty: '1' }]);
  const [payAmount, setPayAmount] = useState(''); const [invoices, setInvoices] = useState<any[]>([]); const [last, setLast] = useState<any>(null);
  const load = () => api('/master/invoices', {}).then(setInvoices).catch(() => {});
  useEffect(() => { load(); }, []);
  const build = () => ({ partyId: partyId || undefined, warehouseId, businessDate: date, idempotencyKey: key(), lines: lines.filter(l => l.productId).map(l => ({ productId: l.productId, qty: l.qty, freeQty: l.freeQty || undefined })), payments: payAmount ? [{ method: 'cash', amount: payAmount }] : undefined });
  return <section className="card"><h1>🧾 المبيعات ونقطة البيع</h1>
    <div className="row"><label>العميل<select value={partyId} onChange={e => setPartyId(e.target.value)}><option value="">بيع نقدي (بدون عميل)</option>{m.parties.filter((p: any) => p.kind !== 'supplier').map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>المخزن<select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}><option value="">اختر…</option>{m.warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <label>التاريخ<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label>مبلغ مدفوع نقداً<input value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder="اتركه فارغاً للآجل" /></label></div>
    <LineEditor m={m} lines={lines} setLines={setLines} />
    <div className="row"><button onClick={async () => { const r = await run(() => api('/sales/invoices', build()), 'تم حفظ وترحيل الفاتورة'); setLast(r); load(); }}>💾 حفظ وترحيل</button>
      <button onClick={async () => { const r = await run(() => api('/sales/invoices/draft', build()), 'حُفظت كمسودة — ليست فاتورة ضريبية ولا أثر محاسبياً لها'); setLast(r); load(); }}>حفظ بدون ترحيل نهائي (مسودة)</button></div>
    {last && <p className="success">آخر فاتورة: الرقم {fmt(last.number)} — الإجمالي {fmt(last.total)} — الحالة المحاسبية {fmt(last.accountingStatus)} — الدفع {fmt(last.paymentStatus)}</p>}
    <h3>أحدث الفواتير</h3>
    <div className="tablewrap"><table><thead><tr><th>الرقم</th><th>التاريخ</th><th>الإجمالي</th><th>المحاسبة</th><th>الدفع</th><th>الضريبة</th><th>إجراءات</th></tr></thead>
    <tbody>{invoices.map((inv: any) => <tr key={inv.id}><td>{inv.number ?? 'مسودة'}</td><td>{String(inv.businessDate).slice(0, 10)}</td><td>{fmt(inv.total)}</td>
      <td><span className={'badge ' + inv.accountingStatus}>{statusAr(inv.accountingStatus)}</span></td><td><span className={'badge ' + inv.paymentStatus}>{statusAr(inv.paymentStatus)}</span></td><td><span className="badge">{statusAr(inv.taxStatus)}</span></td>
      <td><button className="ghost" onClick={() => printInvoice(inv, m)}>🖨 طباعة</button>{' '}
      {inv.accountingStatus !== 'posted' && <button onClick={async () => { await run(() => api('/sales/invoices/post-draft', { invoiceId: inv.id }), 'تم ترحيل المسودة'); load(); }}>ترحيل</button>}</td></tr>)}</tbody></table></div>
    <ReturnsBox m={m} run={run} invoices={invoices} />
    <div className="row"><button onClick={load}>تحديث القائمة</button></div></section>;
}

function PurchasesPage({ m, run }: any) {
  const [partyId, setPartyId] = useState(''); const [warehouseId, setWarehouseId] = useState(''); const [date, setDate] = useState(today());
  const [lines, setLines] = useState<any[]>([{ productId: '', qty: '1', unitCost: '' }]); const [rows, setRows] = useState<any[]>([]);
  const load = () => api('/master/supplier-invoices', {}).then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);
  return <section className="card"><h1>🚚 المشتريات (فواتير موردين)</h1>
    <div className="row"><label>المورد<select value={partyId} onChange={e => setPartyId(e.target.value)}><option value="">اختر…</option>{m.parties.filter((p: any) => p.kind !== 'customer').map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>المخزن<select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}><option value="">اختر…</option>{m.warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <label>التاريخ<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label></div>
    <LineEditor m={m} lines={lines} setLines={setLines} withCost />
    <button onClick={async () => { await run(() => api('/purchasing/supplier-invoices', { partyId, warehouseId, businessDate: date, idempotencyKey: key(), lines: lines.filter(l => l.productId).map(l => ({ productId: l.productId, qty: l.qty, unitCost: l.unitCost })) }), 'تم ترحيل فاتورة المورد ودخلت البضاعة المخزون'); load(); }}>ترحيل فاتورة المورد</button>
    <h3>أحدث فواتير الموردين</h3><Table rows={rows} /></section>;
}

function PartiesPage({ m, run }: any) {
  const [f, setF] = useState({ kind: 'customer', name: '', phone: '', taxNumber: '', creditLimit: '0' });
  const [stmt, setStmt] = useState<any>(null);
  return <section className="card"><h1>👥 العملاء والموردون</h1>
    <form onSubmit={async e => { e.preventDefault(); await run(() => api('/parties', { ...f, creditLimit: f.creditLimit || undefined })); setF({ ...f, name: '' }); }}>
      <div className="row"><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="customer">عميل</option><option value="supplier">مورد</option><option value="both">عميل ومورد</option></select>
        <input required placeholder="الاسم" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
        <input placeholder="الهاتف" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
        <input placeholder="الرقم الضريبي" value={f.taxNumber} onChange={e => setF({ ...f, taxNumber: e.target.value })} />
        <input placeholder="حد الائتمان" value={f.creditLimit} onChange={e => setF({ ...f, creditLimit: e.target.value })} />
        <button type="submit">إضافة</button></div></form>
    <Table rows={m.parties} />
    <h3>كشف حساب طرف</h3>
    <div className="row"><select id="stmtParty"><option value="">اختر…</option>{m.parties.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <button onClick={async () => { const id = (document.getElementById('stmtParty') as HTMLSelectElement).value; if (id) setStmt(await api('/parties/statement', { partyId: id }).catch((e: any) => ({ error: e.message }))); }}>عرض الكشف</button></div>
    {stmt && <ReportView data={stmt} />}</section>;
}

function InventoryPage({ m, run }: any) {
  const [unit, setUnit] = useState({ code: '', name: '' });
  const [prod, setProd] = useState({ sku: '', nameAr: '', stockUnitId: '', defaultPrice: '0', taxRate: '15' });
  const [wh, setWh] = useState({ code: '', name: '' });
  const [balances, setBalances] = useState<any[]>([]); const [valuation, setValuation] = useState<any>(null);
  const [open, setOpen] = useState({ productId: '', warehouseId: '', qty: '', unitCost: '', businessDate: today() });
  const loadBal = () => api('/master/stock-balances', {}).then(setBalances).catch(() => {});
  useEffect(() => { loadBal(); }, []);
  const names = (rows: any[]) => rows.map(r => ({ ...r, product: m.products.find((p: any) => p.id === r.productId)?.nameAr ?? r.productId, warehouse: m.warehouses.find((w: any) => w.id === r.warehouseId)?.name ?? r.warehouseId }));
  return <section className="card"><h1>📦 المخزون والمنتجات</h1>
    <h3>وحدة قياس جديدة</h3>
    <form onSubmit={async e => { e.preventDefault(); await run(() => api('/master/units/create', unit)); setUnit({ code: '', name: '' }); }}><div className="row">
      <input required placeholder="الرمز (pcs)" value={unit.code} onChange={e => setUnit({ ...unit, code: e.target.value })} />
      <input required placeholder="الاسم (حبة)" value={unit.name} onChange={e => setUnit({ ...unit, name: e.target.value })} /><button type="submit">إضافة وحدة</button></div></form>
    <h3>منتج جديد</h3>
    <form onSubmit={async e => { e.preventDefault(); await run(() => api('/master/products/create', { ...prod, stockUnitId: prod.stockUnitId || m.units[0]?.id })); setProd({ ...prod, sku: '', nameAr: '' }); }}><div className="row">
      <input required placeholder="SKU" value={prod.sku} onChange={e => setProd({ ...prod, sku: e.target.value })} />
      <input required placeholder="اسم المنتج" value={prod.nameAr} onChange={e => setProd({ ...prod, nameAr: e.target.value })} />
      <select value={prod.stockUnitId} onChange={e => setProd({ ...prod, stockUnitId: e.target.value })}><option value="">وحدة المخزون…</option>{m.units.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
      <input placeholder="سعر البيع الافتراضي" value={prod.defaultPrice} onChange={e => setProd({ ...prod, defaultPrice: e.target.value })} />
      <input placeholder="نسبة الضريبة %" value={prod.taxRate} onChange={e => setProd({ ...prod, taxRate: e.target.value })} />
      <button type="submit">إضافة منتج</button></div></form>
    <Table rows={m.products} />
    <h3>مخزن جديد</h3>
    <form onSubmit={async e => { e.preventDefault(); await run(() => api('/master/warehouses/create', wh)); setWh({ code: '', name: '' }); }}><div className="row">
      <input required placeholder="الرمز" value={wh.code} onChange={e => setWh({ ...wh, code: e.target.value })} />
      <input required placeholder="اسم المخزن" value={wh.name} onChange={e => setWh({ ...wh, name: e.target.value })} /><button type="submit">إضافة مخزن</button></div></form>
    <Table rows={m.warehouses} />
    <h3>رصيد افتتاحي (إدخال مخزون بتكلفة حقيقية)</h3>
    <div className="row"><select value={open.productId} onChange={e => setOpen({ ...open, productId: e.target.value })}><option value="">منتج…</option>{m.products.map((p: any) => <option key={p.id} value={p.id}>{p.nameAr}</option>)}</select>
      <select value={open.warehouseId} onChange={e => setOpen({ ...open, warehouseId: e.target.value })}><option value="">مخزن…</option>{m.warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
      <input placeholder="الكمية" value={open.qty} onChange={e => setOpen({ ...open, qty: e.target.value })} />
      <input placeholder="تكلفة الوحدة" value={open.unitCost} onChange={e => setOpen({ ...open, unitCost: e.target.value })} />
      <input type="date" value={open.businessDate} onChange={e => setOpen({ ...open, businessDate: e.target.value })} />
      <button onClick={() => run(() => api('/inventory/movements', { ...open, type: 'opening', sourceType: 'opening_balance', sourceId: key(), idempotencyKey: key() }), 'تم إدخال الرصيد الافتتاحي').then(loadBal)}>إدخال</button></div>
    <h3>أرصدة المخزون الحالية</h3><Table rows={names(balances)} />
    <div className="row"><button onClick={loadBal}>تحديث الأرصدة</button>
      <button onClick={async () => setValuation(await api('/reports/inventory-valuation', {}).catch((e: any) => ({ error: e.message })))}>تقييم المخزون</button></div>
    {valuation && <ReportView data={valuation} />}</section>;
}

function AccountingPage({ m, run }: any) {
  const [acc, setAcc] = useState({ code: '', name: '', type: 'asset' });
  const [jLines, setJLines] = useState<any[]>([{ accountId: '', debit: '0', credit: '0' }, { accountId: '', debit: '0', credit: '0' }]);
  const [desc, setDesc] = useState(''); const [date, setDate] = useState(today());
  const [journals, setJournals] = useState<any[]>([]); const [tb, setTb] = useState<any>(null);
  const load = () => api('/master/journals', {}).then(setJournals).catch(() => {});
  useEffect(() => { load(); }, []);
  const totalD = jLines.reduce((a, l) => a + (parseFloat(l.debit) || 0), 0); const totalC = jLines.reduce((a, l) => a + (parseFloat(l.credit) || 0), 0);
  const upd = (i: number, f: string, v: string) => setJLines(jLines.map((l, j) => j === i ? { ...l, [f]: v } : l));
  return <section className="card"><h1>📒 المحاسبة ودليل الحسابات</h1>
    <h3>حساب جديد</h3>
    <form onSubmit={async e => { e.preventDefault(); await run(() => api('/master/accounts/create', acc)); setAcc({ code: '', name: '', type: 'asset' }); }}><div className="row">
      <input required placeholder="رقم الحساب (1100)" value={acc.code} onChange={e => setAcc({ ...acc, code: e.target.value })} />
      <input required placeholder="اسم الحساب" value={acc.name} onChange={e => setAcc({ ...acc, name: e.target.value })} />
      <select value={acc.type} onChange={e => setAcc({ ...acc, type: e.target.value })}><option value="asset">أصول</option><option value="liability">خصوم</option><option value="equity">حقوق ملكية</option><option value="revenue">إيرادات</option><option value="expense">مصروفات</option></select>
      <button type="submit">إضافة حساب</button></div></form>
    <Table rows={m.accounts} />
    <h3>قيد يومية يدوي (يجب أن يتوازن)</h3>
    <div className="row"><input type="date" value={date} onChange={e => setDate(e.target.value)} /><input placeholder="البيان" value={desc} onChange={e => setDesc(e.target.value)} /></div>
    {jLines.map((l, i) => <div className="row" key={i}>
      <select value={l.accountId} onChange={e => upd(i, 'accountId', e.target.value)}><option value="">حساب…</option>{m.accounts.map((a: any) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select>
      <input placeholder="مدين" value={l.debit} onChange={e => upd(i, 'debit', e.target.value)} />
      <input placeholder="دائن" value={l.credit} onChange={e => upd(i, 'credit', e.target.value)} />
      <button type="button" onClick={() => setJLines(jLines.filter((_, j) => j !== i))}>✖</button></div>)}
    <div className="row"><button type="button" onClick={() => setJLines([...jLines, { accountId: '', debit: '0', credit: '0' }])}>+ سطر</button>
      <span className={totalD === totalC && totalD > 0 ? 'success' : 'error'}>مدين {totalD} / دائن {totalC} {totalD === totalC && totalD > 0 ? '— متوازن ✅' : '— غير متوازن'}</span>
      <button disabled={!(totalD === totalC && totalD > 0)} onClick={async () => { await run(() => api('/accounting/journals', { businessDate: date, description: desc, idempotencyKey: key(), lines: jLines.filter(l => l.accountId) }), 'تم ترحيل القيد'); load(); }}>ترحيل القيد</button></div>
    <h3>أحدث القيود المرحّلة</h3><Table rows={journals.map(j => ({ number: j.number, businessDate: j.businessDate, description: j.description, status: j.status, sourceType: j.sourceType, lines: j.lines?.length }))} />
    <div className="row"><button onClick={load}>تحديث</button>
      <button onClick={async () => setTb(await api('/reports/trial-balance', { asOf: today() }).catch((e: any) => ({ error: e.message })))}>ميزان المراجعة اليوم</button></div>
    {tb && <ReportView data={tb} />}</section>;
}

function ProductionPage({ m, run }: any) {
  const [bom, setBom] = useState({ productId: '', name: '' }); const [bomLines, setBomLines] = useState<any[]>([{ productId: '', qty: '1' }]);
  const [boms, setBoms] = useState<any[]>([]); const [orders, setOrders] = useState<any[]>([]);
  const [order, setOrder] = useState({ bomId: '', warehouseId: '', plannedQty: '100', businessDate: today() });
  const [complete, setComplete] = useState({ orderId: '', goodQty: '', labour: '', businessDate: today(), consumptionText: '' });
  const load = () => { api('/master/boms', {}).then(setBoms).catch(() => {}); api('/master/production-orders', {}).then(setOrders).catch(() => {}); };
  useEffect(load, []);
  return <section className="card"><h1>🏭 التصنيع (BOM وأوامر الإنتاج)</h1>
    <h3>وصفة إنتاج (BOM) جديدة</h3>
    <div className="row"><select value={bom.productId} onChange={e => setBom({ ...bom, productId: e.target.value })}><option value="">المنتج التام…</option>{m.products.map((p: any) => <option key={p.id} value={p.id}>{p.nameAr}</option>)}</select>
      <input placeholder="اسم الوصفة" value={bom.name} onChange={e => setBom({ ...bom, name: e.target.value })} /></div>
    <LineEditor m={m} lines={bomLines} setLines={setBomLines} />
    <button onClick={async () => { await run(() => api('/manufacturing/boms', { productId: bom.productId, name: bom.name || 'وصفة', lines: bomLines.filter(l => l.productId).map(l => ({ ingredientProductId: l.productId, qtyPerUnit: l.qty })) })); load(); }}>حفظ الوصفة</button>
    <Table rows={boms.map(b => ({ name: b.name, productId: b.productId, version: b.version, lines: b.lines?.length }))} />
    <h3>أمر إنتاج جديد</h3>
    <div className="row"><select value={order.bomId} onChange={e => setOrder({ ...order, bomId: e.target.value })}><option value="">الوصفة…</option>{boms.map((b: any) => <option key={b.id} value={b.id}>{b.name} v{b.version}</option>)}</select>
      <select value={order.warehouseId} onChange={e => setOrder({ ...order, warehouseId: e.target.value })}><option value="">المخزن…</option>{m.warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
      <input placeholder="الكمية المخططة" value={order.plannedQty} onChange={e => setOrder({ ...order, plannedQty: e.target.value })} />
      <input type="date" value={order.businessDate} onChange={e => setOrder({ ...order, businessDate: e.target.value })} />
      <button onClick={async () => { await run(() => api('/manufacturing/orders', { ...order, idempotencyKey: key() })); load(); }}>إنشاء الأمر</button></div>
    <Table rows={orders} />
    <h3>إتمام أمر إنتاج</h3>
    <p className="muted">الاستهلاك الفعلي: سطر لكل مادة بصيغة «معرّف المنتج = الكمية» — انسخ المعرّفات من جدول المنتجات في صفحة المخزون.</p>
    <div className="row"><select value={complete.orderId} onChange={e => setComplete({ ...complete, orderId: e.target.value })}><option value="">الأمر…</option>{orders.filter((o: any) => o.status === 'planned').map((o: any) => <option key={o.id} value={o.id}>#{o.number ?? o.id.slice(0, 8)} — مخطط {o.plannedQty}</option>)}</select>
      <input placeholder="كمية سليمة منتَجة" value={complete.goodQty} onChange={e => setComplete({ ...complete, goodQty: e.target.value })} />
      <input placeholder="تكلفة عمالة مباشرة (اختياري)" value={complete.labour} onChange={e => setComplete({ ...complete, labour: e.target.value })} />
      <input type="date" value={complete.businessDate} onChange={e => setComplete({ ...complete, businessDate: e.target.value })} /></div>
    <textarea placeholder={'مثال:\n<معرف الدقيق> = 50\n<معرف السكر> = 10'} value={complete.consumptionText} onChange={e => setComplete({ ...complete, consumptionText: e.target.value })} rows={3} style={{ width: '100%' }} />
    <button onClick={async () => { const consumption = complete.consumptionText.split('\n').filter(Boolean).map(l => { const [p, q] = l.split('='); return { productId: p.trim(), actualQty: q.trim() }; });
      await run(() => api('/manufacturing/orders/complete', { orderId: complete.orderId, businessDate: complete.businessDate, goodQty: complete.goodQty, consumption, components: complete.labour ? [{ kind: 'labour', amount: complete.labour }] : [] }), 'اكتمل الإنتاج وحُسبت التكلفة'); load(); }}>إتمام واحتساب التكلفة</button>
  </section>;
}

function RepsPage({ m, run }: any) {
  const [emp, setEmp] = useState(''); const [assignEmp, setAssignEmp] = useState('');
  const [transfer, setTransfer] = useState({ fromWarehouseId: '', toWarehouseId: '', businessDate: today() });
  const [tLines, setTLines] = useState<any[]>([{ productId: '', qty: '1' }]);
  const [transfers, setTransfers] = useState<any[]>([]); const [settlements, setSettlements] = useState<any[]>([]);
  const [settle, setSettle] = useState({ employeeId: '', periodStart: today(), periodEnd: today() });
  const load = () => { api('/master/transfers', {}).then(setTransfers).catch(() => {}); api('/master/settlements', {}).then(setSettlements).catch(() => {}); };
  useEffect(load, []);
  return <section className="card"><h1>🚐 المندوبون والتحويلات والتسويات</h1>
    <h3>موظف جديد / تعيين مندوب (تُنشأ له عهدة مخزنية)</h3>
    <div className="row"><input placeholder="اسم الموظف" value={emp} onChange={e => setEmp(e.target.value)} />
      <button onClick={() => run(() => api('/master/employees/create', { fullName: emp })).then(() => setEmp(''))}>إضافة موظف</button>
      <select value={assignEmp} onChange={e => setAssignEmp(e.target.value)}><option value="">موظف…</option>{m.employees.map((e2: any) => <option key={e2.id} value={e2.id}>{e2.fullName}</option>)}</select>
      <button onClick={() => run(() => api('/representatives/assign', { employeeId: assignEmp }), 'تم تعيين المندوب وإنشاء مخزن عهدته')}>تعيين كمندوب</button></div>
    <Table rows={m.employees} />
    <h3>تحويل بضاعة لمندوب (إرسال عهدة)</h3>
    <div className="row"><select value={transfer.fromWarehouseId} onChange={e => setTransfer({ ...transfer, fromWarehouseId: e.target.value })}><option value="">من مخزن…</option>{m.warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
      <select value={transfer.toWarehouseId} onChange={e => setTransfer({ ...transfer, toWarehouseId: e.target.value })}><option value="">إلى مخزن/عهدة…</option>{m.warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name} ({w.kind})</option>)}</select>
      <input type="date" value={transfer.businessDate} onChange={e => setTransfer({ ...transfer, businessDate: e.target.value })} /></div>
    <LineEditor m={m} lines={tLines} setLines={setTLines} />
    <button onClick={async () => { await run(() => api('/representatives/transfers/dispatch', { ...transfer, idempotencyKey: key(), lines: tLines.filter(l => l.productId).map(l => ({ productId: l.productId, qty: l.qty })) }), 'تم إرسال العهدة — بانتظار استلام المندوب'); load(); }}>إرسال التحويل</button>
    <Table rows={transfers.map(x => ({ number: x.number, status: x.status, businessDate: x.businessDate, lines: x.lines?.length, id: x.id }))} />
    <h3>طلب تسوية مندوب</h3>
    <div className="row"><select value={settle.employeeId} onChange={e => setSettle({ ...settle, employeeId: e.target.value })}><option value="">المندوب (موظف)…</option>{m.employees.map((e2: any) => <option key={e2.id} value={e2.id}>{e2.fullName}</option>)}</select>
      <input type="date" value={settle.periodStart} onChange={e => setSettle({ ...settle, periodStart: e.target.value })} />
      <input type="date" value={settle.periodEnd} onChange={e => setSettle({ ...settle, periodEnd: e.target.value })} />
      <button onClick={async () => { await run(() => api('/representatives/settlements/request', settle), 'تم إنشاء طلب التسوية'); load(); }}>طلب تسوية</button></div>
    <Table rows={settlements.map(x => ({ status: x.status, employeeId: x.employeeId, expectedCash: x.expectedCash, countedCash: x.countedCash, periodStart: x.periodStart, periodEnd: x.periodEnd }))} />
    <p className="muted">أي عجز يظهر كاستثناء للتحقيق والاعتماد — لا يتحول تلقائياً إلى دَين على الموظف أو خصم راتب.</p></section>;
}

function ReportsPage({ run }: any) {
  const [report, setReport] = useState<any>(null); const [title, setTitle] = useState('');
  const [ledgerAcc, setLedgerAcc] = useState('');
  const show = async (name: string, fn: () => Promise<any>) => { setTitle(name); try { setReport(await fn()); } catch (e: any) { setReport({ error: e.message }); } };
  const month = { from: today().slice(0, 8) + '01', to: today() };
  return <section className="card"><h1>📊 التقارير المالية</h1>
    <div className="row">
      <button onClick={() => show('ميزان المراجعة', () => api('/reports/trial-balance', { asOf: today() }))}>ميزان المراجعة</button>
      <button onClick={() => show('قائمة الدخل (الشهر الحالي)', () => api('/reports/income-statement', month))}>قائمة الدخل</button>
      <button onClick={() => show('الميزانية العمومية', () => api('/reports/balance-sheet', { asOf: today() }))}>الميزانية العمومية</button>
      <button onClick={() => show('المبيعات (الشهر الحالي)', () => api('/reports/sales', month))}>المبيعات</button>
      <button onClick={() => show('تقييم المخزون', () => api('/reports/inventory-valuation', {}))}>تقييم المخزون</button>
      <button onClick={() => show('أعمار ذمم العملاء', () => api('/reports/aging', { kind: 'customer', asOf: today() }))}>أعمار العملاء</button>
      <button onClick={() => show('أعمار ذمم الموردين', () => api('/reports/aging', { kind: 'supplier', asOf: today() }))}>أعمار الموردين</button>
      <button onClick={() => show('فحوص المطابقة', () => api('/reports/reconciliations', { asOf: today() }))}>فحوص المطابقة</button>
    </div>
    <div className="row"><input placeholder="كود حساب لدفتر الأستاذ (مثال 1100)" value={ledgerAcc} onChange={e => setLedgerAcc(e.target.value)} />
      <button onClick={() => show('دفتر الأستاذ ' + ledgerAcc, () => api('/reports/ledger', { ...month, accountCode: ledgerAcc }))}>عرض دفتر الأستاذ</button></div>
    {title && <h3>{title}</h3>}{report && <ReportView data={report} />}</section>;
}

function UsersBox({ m, run }: any) {
  const [users, setUsers] = useState<any[]>([]); const [roles, setRoles] = useState<any[]>([]);
  const [f, setF] = useState({ email: '', password: '', displayName: '', roleCode: 'ACCOUNTANT' });
  const load = () => { api('/master/users', {}).then(setUsers).catch(() => {}); api('/master/roles', {}).then((r: any[]) => setRoles(r)).catch(() => {}); };
  useEffect(() => { load(); }, []);
  return <div>
    <div className="row"><input placeholder="البريد الإلكتروني" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
      <input placeholder="الاسم" value={f.displayName} onChange={e => setF({ ...f, displayName: e.target.value })} />
      <input type="password" placeholder="كلمة مرور (10+ حروف وأرقام)" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
      <select value={f.roleCode} onChange={e => setF({ ...f, roleCode: e.target.value })}>{roles.map((r: any) => <option key={r.id} value={r.code}>{r.code}</option>)}</select>
      <button onClick={async () => { await run(() => api('/master/users/create', f), 'تم إنشاء المستخدم'); load(); }}>إنشاء مستخدم</button></div>
    <Table rows={users.map((u: any) => ({ email: u.email, displayName: u.displayName, isActive: u.isActive, roles: u.roles?.map((x: any) => x.role?.code).join(',') }))} />
    <p className="muted">الأدوار المتاحة: {roles.map((r: any) => r.code).join(' · ') || '—'} — مالك الشركة (TENANT_OWNER) يملك كل الصلاحيات عدا إدارة المنصة.</p></div>;
}

const PURPOSES: [string, string][] = [['CASH_ON_HAND', 'النقدية بالخزينة'], ['AR_CUSTOMER', 'ذمم العملاء'], ['AP_SUPPLIER', 'ذمم الموردين'], ['INVENTORY', 'المخزون'], ['COGS', 'تكلفة المبيعات'], ['SALES_REVENUE', 'إيرادات المبيعات'], ['VAT_OUTPUT', 'ضريبة مخرجات (مستحقة)'], ['VAT_INPUT', 'ضريبة مدخلات (قابلة للخصم)'], ['FREE_GOODS_EXPENSE', 'مصروف بضاعة مجانية'], ['EXPENSE_GENERAL', 'مصروفات عامة'], ['SCRAP_LOSS', 'خسائر تالف إنتاج'], ['PRODUCTION_LABOUR', 'عمالة إنتاج مباشرة'], ['PRODUCTION_OVERHEAD', 'تكاليف إنتاج غير مباشرة'], ['PRODUCTION_OTHER', 'تكاليف إنتاج أخرى']];
function SettingsPage({ m, run, setupDone }: any) {
  const [fy, setFy] = useState({ name: String(new Date().getFullYear()), startDate: today().slice(0, 4) + '-01-01', endDate: today().slice(0, 4) + '-12-31' });
  const [mapPurpose, setMapPurpose] = useState('SALES_REVENUE'); const [mapAccount, setMapAccount] = useState('');
  const [cashAcc, setCashAcc] = useState({ name: '', kind: 'cash', accountId: '' });
  const [tax, setTax] = useState({ vatRegistered: true, vatNumber: '' });
  const mapped = new Set(m.mappings.map((x: any) => x.purpose));
  return <section className="card"><h1>⚙️ الإعدادات ومعالج التهيئة</h1>
    <ol className="checklist">
      <li>{setupDone.fy ? '✅' : '⬜'} <b>1) السنة المالية</b> — تُنشئ 12 فترة شهرية مفتوحة تلقائياً</li>
      <li>{setupDone.accounts ? '✅' : '⬜'} <b>2) دليل الحسابات</b> — من صفحة المحاسبة</li>
      <li>{setupDone.mappings ? '✅' : '⬜'} <b>3) الربط المحاسبي</b> — {m.mappings.length} من {PURPOSES.length} غرضاً مُكوَّناً (الأساسي للمبيعات 8 على الأقل)</li>
      <li>{setupDone.products && setupDone.warehouses ? '✅' : '⬜'} <b>4) المنتجات والمخازن</b> — من صفحة المخزون</li>
    </ol>
    <h3>سنة مالية جديدة</h3>
    <div className="row"><input value={fy.name} onChange={e => setFy({ ...fy, name: e.target.value })} placeholder="الاسم" />
      <input type="date" value={fy.startDate} onChange={e => setFy({ ...fy, startDate: e.target.value })} />
      <input type="date" value={fy.endDate} onChange={e => setFy({ ...fy, endDate: e.target.value })} />
      <button onClick={() => run(() => api('/master/fiscal-years/create', fy), 'تم إنشاء السنة المالية وفتراتها')}>إنشاء</button></div>
    <Table rows={m.fiscalYears.map((f: any) => ({ name: f.name, startDate: f.startDate, endDate: f.endDate, periods: f.periods?.length }))} />
    <h3>الربط المحاسبي (أي غرض غير مُكوَّن يوقف الترحيل بخطأ صريح — لا تخمين)</h3>
    <div className="row"><select value={mapPurpose} onChange={e => setMapPurpose(e.target.value)}>{PURPOSES.map(([k, label]) => <option key={k} value={k}>{label} ({k}) {mapped.has(k) ? '✅' : '⬜'}</option>)}</select>
      <select value={mapAccount} onChange={e => setMapAccount(e.target.value)}><option value="">الحساب…</option>{m.accounts.map((a: any) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select>
      <button onClick={() => run(() => api('/master/mappings/set', { purpose: mapPurpose, accountId: mapAccount }), 'تم حفظ الربط')}>حفظ الربط</button></div>
    <Table rows={m.mappings.map((x: any) => ({ purpose: (PURPOSES.find(([k]) => k === x.purpose)?.[1] ?? x.purpose), account: (() => { const a = m.accounts.find((a2: any) => a2.id === x.accountId); return a ? a.code + ' — ' + a.name : '—'; })() }))} />
    <h3>حساب نقدي/بنكي (للخزينة والمصروفات والمدفوعات)</h3>
    <div className="row"><input placeholder="اسم الخزينة" value={cashAcc.name} onChange={e => setCashAcc({ ...cashAcc, name: e.target.value })} />
      <select value={cashAcc.kind} onChange={e => setCashAcc({ ...cashAcc, kind: e.target.value })}><option value="cash">نقدي</option><option value="bank">بنكي</option></select>
      <select value={cashAcc.accountId} onChange={e => setCashAcc({ ...cashAcc, accountId: e.target.value })}><option value="">حساب الأستاذ المرتبط…</option>{m.accounts.map((a: any) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select>
      <button onClick={() => run(() => api('/master/cash-accounts/create', cashAcc), 'تم إنشاء الحساب النقدي')}>إنشاء</button></div>
    <Table rows={m.cashAccounts} />
    <h3>إعدادات ضريبة القيمة المضافة للشركة</h3>
    <div className="row"><label><input type="checkbox" checked={tax.vatRegistered} onChange={e => setTax({ ...tax, vatRegistered: e.target.checked })} /> مسجّل في ضريبة القيمة المضافة</label>
      <input placeholder="الرقم الضريبي (15 رقماً)" value={tax.vatNumber} onChange={e => setTax({ ...tax, vatNumber: e.target.value })} />
      <button onClick={() => run(() => api('/master/tenant/tax', tax), 'تم حفظ الإعداد الضريبي')}>حفظ</button></div>
    <h3>المستخدمون والأدوار</h3><UsersBox m={m} run={run} />
    <p className="muted">تنبيه: حفظ هذه الإعدادات لا يُفعّل الإرسال إلى ZATCA — الإرسال الإنتاجي يبقى معطّلاً حتى إتمام الانضمام الرسمي والاعتماد القانوني.</p></section>;
}

function printInvoice(inv: any, m: Master) {
  const area = document.getElementById('printArea'); if (!area) return;
  const party = m.parties.find((p: any) => p.id === inv.partyId);
  const rows = (inv.lines ?? []).map((l: any) => `<tr><td>${m.products.find((p: any) => p.id === l.productId)?.nameAr ?? l.productId}</td><td>${l.qty}</td><td>${l.freeQty}</td><td>${l.unitPrice}</td><td>${l.taxRate}%</td><td>${l.lineTotal}</td></tr>`).join('');
  area.innerHTML = `<div style="text-align:center"><h2>فاتورة ضريبية ${inv.taxStatus === 'cleared' || inv.taxStatus === 'reported' ? '' : '(نسخة داخلية — الحالة الضريبية: ' + inv.taxStatus + ')'}</h2></div>
  <p>رقم الفاتورة: ${inv.number ?? '—'} | التاريخ: ${String(inv.businessDate).slice(0, 10)} | العميل: ${party?.name ?? 'بيع نقدي'} ${party?.taxNumber ? '| رقمه الضريبي: ' + party.taxNumber : ''}</p>
  <table><thead><tr><th>المنتج</th><th>الكمية</th><th>مجاني</th><th>سعر الوحدة</th><th>الضريبة</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>
  <p>المجموع قبل الضريبة: ${inv.subtotal} | الخصم: ${inv.discountTotal} | ضريبة القيمة المضافة: ${inv.taxTotal} | <b>الإجمالي المستحق: ${inv.total} ر.س</b> | المدفوع: ${inv.paidAmount}</p>
  <p style="font-size:11px">أُنشئت من نظام ERPCloud. إعادة الطباعة لا تغيّر الفاتورة الأصلية ولا تاريخها. رمز QR والختم التشفيري يصدران فقط من بوابة ZATCA بعد إرسال/اعتماد فعلي — لا يُطبعان هنا افتراضياً.</p>`;
  window.print();
}

function ReturnsBox({ m, run, invoices }: any) {
  const [invoiceId, setInvoiceId] = useState(''); const [lines, setLines] = useState<any[]>([{ productId: '', qty: '1' }]);
  const [date, setDate] = useState(today()); const [warehouseId, setWarehouseId] = useState('');
  return <div><h3>↩️ مرتجع مبيعات (إشعار دائن)</h3>
    <div className="row"><select value={invoiceId} onChange={e => setInvoiceId(e.target.value)}><option value="">الفاتورة الأصلية…</option>{invoices.filter((i: any) => i.accountingStatus === 'posted').map((i: any) => <option key={i.id} value={i.id}>#{i.number} — {fmt(i.total)} ر.س</option>)}</select>
      <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}><option value="">مخزن الإرجاع…</option>{m.warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
    <LineEditor m={m} lines={lines} setLines={setLines} />
    <button onClick={() => run(() => api('/sales/returns', { originalInvoiceId: invoiceId, warehouseId, businessDate: date, idempotencyKey: key(), lines: lines.filter((l: any) => l.productId).map((l: any) => ({ productId: l.productId, qty: l.qty })) }), 'تم إنشاء المرتجع وإشعاره الدائن')}>ترحيل المرتجع</button></div>;
}

function CashPage({ m, run }: any) {
  const [exp, setExp] = useState({ category: 'مصروفات تشغيلية', description: '', amount: '', cashAccountId: '', businessDate: today() });
  const [pay, setPay] = useState({ partyId: '', direction: 'in', method: 'cash', amount: '', cashAccountId: '', businessDate: today() });
  const [expenses, setExpenses] = useState<any[]>([]);
  const load = () => api('/master/expenses', {}).then(setExpenses).catch(() => {});
  useEffect(() => { load(); }, []);
  return <section className="card"><h1>💰 الخزينة والمصروفات والمدفوعات</h1>
    <h3>مصروف جديد (يُرحّل: مصروف / خزينة)</h3>
    <div className="row"><input placeholder="التصنيف" value={exp.category} onChange={e => setExp({ ...exp, category: e.target.value })} />
      <input placeholder="البيان" value={exp.description} onChange={e => setExp({ ...exp, description: e.target.value })} />
      <input placeholder="المبلغ" value={exp.amount} onChange={e => setExp({ ...exp, amount: e.target.value })} />
      <select value={exp.cashAccountId} onChange={e => setExp({ ...exp, cashAccountId: e.target.value })}><option value="">الخزينة/البنك…</option>{m.cashAccounts.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <input type="date" value={exp.businessDate} onChange={e => setExp({ ...exp, businessDate: e.target.value })} />
      <button onClick={async () => { await run(() => api('/cash/expenses', { ...exp, idempotencyKey: key() }), 'تم ترحيل المصروف'); load(); }}>ترحيل المصروف</button></div>
    <h3>سند قبض / صرف لطرف</h3>
    <div className="row"><select value={pay.partyId} onChange={e => setPay({ ...pay, partyId: e.target.value })}><option value="">الطرف…</option>{m.parties.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <select value={pay.direction} onChange={e => setPay({ ...pay, direction: e.target.value })}><option value="in">قبض (من الطرف)</option><option value="out">صرف (للطرف)</option></select>
      <select value={pay.method} onChange={e => setPay({ ...pay, method: e.target.value })}><option value="cash">نقدي</option><option value="bank">تحويل بنكي</option><option value="card">بطاقة (تسوية لاحقة)</option></select>
      <input placeholder="المبلغ" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} />
      <select value={pay.cashAccountId} onChange={e => setPay({ ...pay, cashAccountId: e.target.value })}><option value="">الخزينة/البنك…</option>{m.cashAccounts.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <input type="date" value={pay.businessDate} onChange={e => setPay({ ...pay, businessDate: e.target.value })} />
      <button onClick={() => run(() => api('/cash/payments', { ...pay, idempotencyKey: key() }), 'تم ترحيل السند')}>ترحيل السند</button></div>
    <p className="muted">الدفع بالبطاقة يُسجَّل كوسيلة دفع ولا يعني نقداً مستلماً حتى التسوية البنكية.</p>
    <h3>أحدث المصروفات</h3><Table rows={expenses} /></section>;
}

createRoot(document.getElementById('root')!).render(<><App /><div id="printArea" /></>);
