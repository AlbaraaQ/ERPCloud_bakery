import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t, type Lang } from './i18n';
import { countByState, syncNow, enqueue } from './offline';
import './styles.css';

function App() {
  const [theme, setTheme] = useState<'light'|'dark'>('light');
  const [lang, setLang] = useState<Lang>('ar');
  const [health, setHealth] = useState('…');
  const [form, setForm] = useState({ tenantSlug:'demo', email:'', password:'' });
  const [user, setUser] = useState<any>(null);
  const [syncCounts, setSyncCounts] = useState<Record<string, number>>({});
  useEffect(()=>{ countByState().then(setSyncCounts).catch(()=>{}); },[]);
  const s = t[lang];
  useEffect(()=>{ document.documentElement.dataset.theme = theme; },[theme]);
  useEffect(()=>{ document.documentElement.lang = lang; document.documentElement.dir = lang==='ar'?'rtl':'ltr'; },[lang]);
  useEffect(()=>{ fetch('/api/v1/health').then(r=>r.json()).then(d=>setHealth(d.status)).catch(()=>setHealth('offline')); },[]);
  async function login(e: React.FormEvent){ e.preventDefault();
    const r = await fetch('/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},credentials:'include',body:JSON.stringify(form)});
    if(r.ok) setUser(await r.json()); else alert(lang==='ar'?'فشل تسجيل الدخول':'Login failed');
  }
  const nav = [s.dashboard,s.sales,s.inventory,s.accounting,s.reps,s.reports,s.settings];
  return (<div className="layout">
    <aside><div className="logo">☁️ {s.app}</div>{nav.map((n,i)=><a key={n} className={i===0?'active':''} href="#">{n}</a>)}</aside>
    <main>
      <header><span>{s.health}: <b>{health}</b></span><span className="spacer"/>
        <button onClick={()=>setLang(lang==='ar'?'en':'ar')}>{lang==='ar'?'English':'العربية'}</button>
        <button onClick={()=>setTheme(theme==='light'?'dark':'light')}>{theme==='light'?'🌙':'☀️'} {s.toggleTheme}</button>
      </header>
      <section className="card"><h2>{lang==='ar'?'لوحة المؤشرات والتقارير':'Dashboard & reports'}</h2>
      <p className="muted">{lang==='ar'?'المؤشرات تُحسب من الدفاتر الرسمية حصراً (قيود مرحّلة وحركات مخزون) — مسار API: ‎/api/v1/reports/*‎ بصلاحية reports.view، مع فحوص مطابقة: توازن ميزان المراجعة، انحراف المخزون، تقييم المخزون مقابل حساب المخزون في الأستاذ.':'Indicators derive only from authoritative ledgers via /api/v1/reports/* (reports.view), with reconciliation checks: trial-balance, stock drift, valuation vs GL.'}</p>
      <div className="row">{['trial-balance','income-statement','balance-sheet','aging','sales','inventory-valuation','reconciliations','dashboard'].map(r=><span key={r} className="chip">{r}</span>)}</div></section>
      <section className="card"><h1>{s.welcome}</h1><p>{s.desc}</p><p className="ok">✅ {s.foundation}</p>
      <div className="card pos">
        <h2>{lang==='ar'?'نقطة البيع — فاتورة جديدة':'POS — New invoice'}</h2>
        <p className="muted">{lang==='ar'?'حوار الحفظ الرسمي: «حفظ وترحيل» ينفّذ المخزون والمحاسبة، و«حفظ بدون ترحيل نهائي» يحفظ مسودة فقط — وليست فاتورة ضريبية.':'Official save dialog: Save & Post posts stock+accounting; Save Without Final Posting keeps a draft — not a tax invoice.'}</p>
        <p>🔄 {lang==='ar'?'حالة المزامنة':'Sync'}: {Object.entries(syncCounts).map(([k,v])=>`${k}:${v}`).join(' · ') || (lang==='ar'?'لا عمليات معلقة':'no pending ops')}
          <button className="secondary" onClick={async()=>{ try{ await enqueue('sales_invoice',{ note:'demo-op' }); setSyncCounts(await countByState()); }catch{} }}>{lang==='ar'?'إضافة عملية محلية (تجريبي)':'Queue local op (demo)'}</button>
          <button onClick={async()=>{ try{ await syncNow(); }catch{} setSyncCounts(await countByState()); }}>{lang==='ar'?'مزامنة الآن':'Sync now'}</button></p>
        <div className="row">
          <button onClick={()=>alert(lang==='ar'?'حفظ وترحيل: يتطلب تسجيل الدخول وبيانات حقيقية من الخادم':'Save & Post: requires login and real server data')}>{lang==='ar'?'💾 حفظ وترحيل':'💾 Save & Post'}</button>
          <button className="secondary" onClick={()=>alert(lang==='ar'?'تم الحفظ كمسودة (عرض واجهة — الربط الكامل مع الخادم في بيئة قاعدة البيانات)':'Saved as draft (UI demo — full server wiring needs the DB environment)')}>{lang==='ar'?'📝 حفظ بدون ترحيل نهائي':'📝 Save Without Final Posting'}</button>
        </div>
      </div>
      {!user ? <form onSubmit={login} className="login">
        <label>{s.tenant}<input value={form.tenantSlug} onChange={e=>setForm({...form,tenantSlug:e.target.value})}/></label>
        <label>{s.email}<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
        <label>{s.password}<input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label>
        <button type="submit">{s.login}</button></form>
      : <p>👤 {user.user?.displayName} — {user.permissions?.length ?? 0} {lang==='ar'?'صلاحية':'permissions'}</p>}
      </section>
    </main></div>);
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
