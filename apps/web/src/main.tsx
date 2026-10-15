import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t, type Lang } from './i18n';
import { countByState, syncNow, enqueue } from './offline';
import './styles.css';

async function api(path: string, body?: unknown) {
  const r = await fetch('/api/v1' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

function App() {
  const [theme, setTheme] = useState<'light'|'dark'>('light');
  const [lang, setLang] = useState<Lang>('ar');
  const [health, setHealth] = useState('…');
  const [form, setForm] = useState({ tenantSlug: 'demo', email: '', password: '' });
  const [user, setUser] = useState<any>(null);
  const [dash, setDash] = useState<any>(null);
  const [report, setReport] = useState<{ title: string; rows: any } | null>(null);
  const [syncCounts, setSyncCounts] = useState<Record<string, number>>({});
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<any>(null);
  const [err, setErr] = useState('');
  const s = t[lang]; const ar = lang === 'ar';
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = ar ? 'rtl' : 'ltr'; }, [lang, ar]);
  useEffect(() => { fetch('/api/v1/health').then(r => r.json()).then(d => setHealth(d.status)).catch(() => setHealth('offline')); countByState().then(setSyncCounts).catch(() => {}); }, []);
  async function login(e: React.FormEvent) { e.preventDefault(); setErr('');
    try { const u = await api('/auth/login', form); setUser(u); setDash(await api('/reports/dashboard')); }
    catch { setErr(ar ? 'فشل تسجيل الدخول — تحقق من البيانات وأن الخادم وقاعدة البيانات يعملان' : 'Login failed — check credentials and that API/DB are up'); } }
  async function showReport(kind: string) { setErr('');
    try {
      const today = new Date().toISOString().slice(0, 10);
      const data = kind === 'trial' ? await api('/reports/trial-balance', { asOf: today })
        : kind === 'income' ? await api('/reports/income-statement', { from: today.slice(0, 8) + '01', to: today })
        : kind === 'valuation' ? await api('/reports/inventory-valuation')
        : kind === 'rec' ? await api('/reports/reconciliations', { asOf: today })
        : await api('/reports/sales', { from: today.slice(0, 8) + '01', to: today });
      setReport({ title: kind, rows: data });
    } catch { setErr(ar ? 'تعذر تحميل التقرير (صلاحية reports.view مطلوبة)' : 'Report failed (reports.view required)'); } }
  const nav = [s.dashboard, s.sales, s.inventory, s.accounting, s.reps, s.reports, s.settings];
  return (<div className="layout">
    <aside><div className="logo">☁️ {s.app}</div>{nav.map((n, i) => <a key={n} className={i === 0 ? 'active' : ''} href="#">{n}</a>)}
      <div className="muted small">🔄 {ar ? 'المزامنة' : 'Sync'}: {Object.entries(syncCounts).map(([k, v]) => `${k}:${v}`).join(' · ') || '—'}</div></aside>
    <main>
      <header><span>{s.health}: <b>{health}</b></span><span className="spacer" />
        <button onClick={() => setLang(ar ? 'en' : 'ar')}>{ar ? 'English' : 'العربية'}</button>
        <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? '🌙' : '☀️'} {s.toggleTheme}</button>
      </header>
      {err && <p className="error" role="alert">⚠️ {err}</p>}
      {!user ? <section className="card"><h1>{s.login}</h1>
        <form onSubmit={login} className="login">
          <label>{s.tenant}<input value={form.tenantSlug} onChange={e => setForm({ ...form, tenantSlug: e.target.value })} /></label>
          <label>{s.email}<input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
          <label>{s.password}<input type="password" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
          <button type="submit">{s.login}</button></form>
        <p className="muted">{ar ? 'نقطة البيع وحوار «حفظ وترحيل / حفظ بدون ترحيل نهائي» يعملان عبر نفس خدمات الخادم بعد تسجيل الدخول.' : 'POS and the Save & Post / Save Without Final Posting dialog run on the same server services after login.'}</p></section>
      : <>
        <section className="card"><h1>{s.welcome}</h1><p>👤 {user.user?.displayName} — {user.permissions?.length ?? 0} {ar ? 'صلاحية' : 'permissions'}</p>
          {dash && <div className="grid">
            <div className="stat"><b>{dash.openSettlements}</b><span>{ar ? 'تسويات مفتوحة' : 'Open settlements'}</span></div>
            <div className="stat"><b>{dash.failedTaxSubmissions}</b><span>{ar ? 'إرسالات ضريبية فاشلة' : 'Failed tax submissions'}</span></div>
            <div className="stat"><b>{dash.rejectedSyncOps}</b><span>{ar ? 'عمليات مزامنة مرفوضة' : 'Rejected sync ops'}</span></div>
            <div className="stat"><b>{dash.pendingTransfers}</b><span>{ar ? 'تحويلات بالطريق' : 'Pending transfers'}</span></div>
          </div>}
          <div className="row">
            <button onClick={() => showReport('trial')}>{ar ? 'ميزان المراجعة' : 'Trial balance'}</button>
            <button onClick={() => showReport('income')}>{ar ? 'قائمة الدخل' : 'Income statement'}</button>
            <button onClick={() => showReport('sales')}>{ar ? 'المبيعات' : 'Sales'}</button>
            <button onClick={() => showReport('valuation')}>{ar ? 'تقييم المخزون' : 'Inventory valuation'}</button>
            <button onClick={() => showReport('rec')}>{ar ? 'فحوص المطابقة' : 'Reconciliations'}</button>
          </div>
          {report && <pre className="report" dir="ltr">{JSON.stringify(report.rows, null, 1).slice(0, 4000)}</pre>}
        </section>
        <section className="card"><h2>🤖 {ar ? 'المساعد الذكي' : 'AI assistant'}</h2>
          <div className="row"><input className="grow" value={question} onChange={e => setQuestion(e.target.value)} placeholder={ar ? 'مثال: ما هي مبيعات هذا الشهر؟' : 'e.g. What were this month\u2019s sales?'} />
          <button onClick={async () => { try { setAnswer(await api('/ai/ask', { question })); } catch { setErr(ar ? 'المساعد غير متاح أو الصلاحية مفقودة' : 'Assistant unavailable or permission missing'); } }}>{ar ? 'اسأل' : 'Ask'}</button></div>
          {answer && <pre className="report" dir="auto">{(answer.answer ?? JSON.stringify(answer.data, null, 1)).slice(0, 3000)}</pre>}
          <p className="muted">{ar ? 'الأرقام من التقارير الرسمية؛ الإجراءات الحساسة تتطلب اعتماداً بشرياً.' : 'Figures come from official reports; sensitive actions need human approval.'}</p>
        </section>
        <section className="card"><h2>🧾 {ar ? 'نقطة البيع' : 'POS'}</h2>
          <p className="muted">{ar ? '«حفظ وترحيل» يرحّل المخزون والمحاسبة ذرّياً عبر خدمات الخادم. «حفظ بدون ترحيل نهائي» يحفظ مسودة — ليست فاتورة ضريبية.' : 'Save & Post posts stock+accounting atomically. Save Without Final Posting keeps a draft — not a tax invoice.'}</p>
          <div className="row">
            <button onClick={async () => { try { await enqueue('sales_invoice', { demo: true }); setSyncCounts(await countByState()); } catch {} }}>{ar ? '💾 حفظ وترحيل (عملية محلية للتجربة)' : '💾 Save & Post (queue demo op)'}</button>
            <button className="secondary" onClick={async () => { try { await syncNow(); } catch {} setSyncCounts(await countByState()); }}>{ar ? '🔄 مزامنة الآن' : '🔄 Sync now'}</button>
          </div>
        </section>
      </>}
    </main></div>);
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
