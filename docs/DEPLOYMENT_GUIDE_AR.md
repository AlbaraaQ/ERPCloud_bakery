# دليل تشغيل ونشر نظام ERPCloud — النسخة الإنتاجية

> هذا الدليل هو المرجع العملي لتشغيل المشروع كاملًا: محليًا، وعلى خادم إنتاجي عبر Docker.
> للحالة الهندسية الكاملة راجع `docs/PROGRESS.md`، وللتشغيل اليومي والحوادث راجع `docs/OPERATIONS.md`،
> ولما هو مُتحقق منه فعليًا مقابل ما لم يُتحقق بعد راجع `docs/RELEASE_READINESS.md` — **اقرأه قبل أي إطلاق إنتاجي فعلي**.

---

## 1) ماذا يسلّم هذا المشروع؟

نظام محاسبة وتشغيل سحابي متعدد المستأجرين (Multi-Tenant) للشركات الصغيرة والمتوسطة في التصنيع الغذائي والتوزيع والمبيعات المتنقلة، ويتكوّن من:

| المكوّن | التقنية | الوظيفة |
|---|---|---|
| واجهة الويب `apps/web` | React + Vite، عربي أولًا RTL مع إنجليزي، وضع فاتح/داكن | المحاسبة والتشغيل ونقطة بيع مكتبية، تقارير، مساعد ذكاء اصطناعي، مزامنة غير متصلة |
| واجهة برمجة التطبيقات `apps/api` | NestJS + Prisma، المنفذ 3001، البادئة `/api/v1` | الخادم المرجعي الوحيد لكل منطق الأعمال |
| الحزمة المشتركة `packages/shared` | TypeScript + decimal.js | الأموال العشرية الدقيقة، كتالوج الصلاحيات، حالات المستندات، الأخطاء |
| قاعدة البيانات | PostgreSQL 16 مع Row-Level Security | عزل المستأجرين على مستوى قاعدة البيانات نفسها |

الدورة الكاملة مدعومة ومُختبَرة: الإنتاج والتصنيع (BOM) ← التحويلات ← المبيعات ← التحصيل ← المرتجعات ← المصروفات ← تسوية المناديب ← القوائم المالية ← الامتثال الضريبي ZATCA (عبر بوابة تكامل).

---

## 2) المتطلبات

### للتشغيل الإنتاجي عبر Docker (الطريقة الموصى بها)
- خادم Linux (Ubuntu 22.04 أو أحدث) بذاكرة 4GB على الأقل ومساحة 40GB.
- Docker Engine 24+ و Docker Compose v2.
- اسم نطاق + شهادة HTTPS (عبر وكيل عكسي مثل Caddy أو Nginx أو Traefik أمام الخدمات).
- منفذ الواجهة الافتراضي `8080` ومنفذ الـ API `3001` (قابلان للتغيير من ملف البيئة).

### للتطوير المحلي بدون Docker
- Node.js 22+ و npm 10+.
- PostgreSQL 16 متاح محليًا (أو استخدم خدمة `db` من `docker-compose.yml`).

---

## 3) التشغيل الإنتاجي عبر Docker — خطوة بخطوة

### الخطوة 1: جلب الكود
```bash
git clone https://github.com/AlbaraaQ/ERPCloud_bakery.git
cd ERPCloud_bakery
git checkout arena/afb14762-erpcloud-bakery   # أو الفرع/الإصدار المعتمد لديك
```

### الخطوة 2: تجهيز ملف البيئة الإنتاجية
```bash
cp .env.production.example .env.production
```
حرّر `.env.production` واملأ **كل** القيم. توليد أسرار قوية:
```bash
openssl rand -hex 32   # استخدمه لـ SESSION_SECRET و BACKUP_ENCRYPTION_KEY وكلمات مرور قاعدة البيانات
```

| المتغير | إلزامي | الوصف |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | نعم | حساب مالك قاعدة البيانات — تستخدمه خدمة الهجرات فقط |
| `APP_DB_USER` / `APP_DB_PASSWORD` | نعم | حساب التطبيق غير المالك (`erp_app`) — تطبق عليه سياسات RLS لعزل المستأجرين |
| `SESSION_SECRET` | نعم | سر توقيع الجلسات، 32 حرفًا على الأقل |
| `WEB_ORIGIN` | نعم | أصل الواجهة العلني، مثال: `https://erp.example.com` |
| `BACKUP_ENCRYPTION_KEY` | نعم | مفتاح تشفير النسخ الاحتياطية AES-256-GCM، 32 حرفًا على الأقل |
| `BACKUP_DIR` | لا | مسار النسخ داخل الحاوية، الافتراضي `/var/backups/erpcloud` |
| `API_PORT` / `WEB_PORT` | لا | منافذ النشر على الخادم، الافتراضية 3001 / 8080 |
| `RUN_SEED` | لأول تشغيل فقط | `true` لإنشاء مستأجر تجريبي ومالكه، ثم أعده `false` |
| `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` | مع `RUN_SEED` | بيانات دخول مالك أول مستأجر — غيّر كلمة المرور فور أول دخول |
| `ZATCA_*` | لا | اتركها فارغة ليبقى الإرسال الضريبي **معطّلًا** (انظر القسم 8) |
| `GOOGLE_DRIVE_*` | لا | بيانات OAuth للنشر — بدونها تفشل ميزة الربط صراحةً ولا تُدّعى نجاحات وهمية |

> ⚠️ لا ترفع `.env.production` إلى Git إطلاقًا (وهو مستبعد في `.gitignore`)، ولا تضع أي أسرار أو شهادات ZATCA في الكود.

### الخطوة 3: أول تشغيل (مع إنشاء أول مستأجر)
في `.env.production` اجعل `RUN_SEED=true` ثم:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f migrate
```
تنتهي خدمة `migrate` برسالة `MIGRATIONS + APP ROLE OK` وتعني:
1. تطبيق كل هجرات Prisma (`prisma migrate deploy`).
2. إنشاء/تحديث دور `erp_app` غير المالك من `apps/api/prisma/app-role.sql`.
3. (اختياريًا) زرع مستأجر `demo` ومالكه.

بعد نجاح أول دخول، أعد `RUN_SEED=false` ثم:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

### الخطوة 4: التحقق من سلامة التشغيل (Smoke Test)
```bash
curl http://localhost:3001/api/v1/health          # {"status":"ok"} — جاهزية العملية
curl http://localhost:3001/api/v1/health/ready    # فحص الاتصال بقاعدة البيانات
curl -I http://localhost:8080/                    # الواجهة تعمل
```
ثم من المتصفح: افتح `http://<الخادم>:8080` وسجّل الدخول ببيانات `SEED_OWNER_*`.
الواجهة تتصل بالـ API عبر وكيل nginx بنفس الأصل (`/api/`) فلا توجد مشاكل CORS في الإنتاج.

### الخطوة 5: HTTPS (إلزامي في الإنتاج الحقيقي)
ضع وكيلًا عكسيًا بشهادة TLS أمام المنفذين، مثال Caddy:
```
erp.example.com {
    reverse_proxy localhost:8080
}
```
وحدّث `WEB_ORIGIN=https://erp.example.com` ثم أعد إنشاء خدمة الـ API:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d api
```

---

## 4) التشغيل المحلي للتطوير

```bash
npm ci
npm run build -w @erpcloud/shared

# قاعدة البيانات (اختر واحدًا):
docker compose up -d db                    # عبر docker-compose.yml التطويري
# أو PostgreSQL محلي ثم عدّل DATABASE_URL

cp .env.example .env                        # عدّل القيم عند الحاجة
cd apps/api
cp .env.example .env                        # مهم: Prisma يقرأ apps/api/.env تحديدًا
npx prisma generate
npx prisma migrate deploy
npx prisma db execute --file prisma/app-role.sql   # بعد تغيير CHANGE_ME لكلمة مرور حقيقية
SEED_OWNER_PASSWORD='كلمة-قوية-123' npm run seed   # اختياري: مستأجر تجريبي

# التشغيل (طرفيتان):
npm run start:dev -w @erpcloud/api          # http://localhost:3001/api/v1
npm run dev -w @erpcloud/web                # http://localhost:5173 (وكيل /api جاهز في Vite)
```

---

## 5) الاختبارات والتحقق قبل أي نشر

```bash
npm run build            # shared + api + web
npm run typecheck
npm test                 # اختبارات وحدة (shared + api)

# اختبارات التكامل على PostgreSQL حقيقي (تتطلب DATABASE_URL كحساب erp_app):
RUN_INTEGRATION=1 npm --workspace=@erpcloud/api exec vitest run test/
```
خط أنابيب CI في `.github/workflows/ci.yml` ينفّذ كل ما سبق تلقائيًا عند كل دفع، بما فيه بناء صور Docker الإنتاجية. **لا تنشر إلا من commit أخضر في CI.**

---

## 6) النسخ الاحتياطي والاستعادة

- آلية مدمجة: تصدير منطقي مشفّر AES-256-GCM عبر وحدة المنصة؛ النسخة لا تُحتسب ناجحة إلا بعد إعادة قراءة الملف والتحقق من SHA-256 وفك التشفير، والاحتفاظ بآخر 18 نسخة محققة.
- في نشر Docker تُحفظ النسخ في وحدة التخزين `backups` (المسار `/var/backups/erpcloud`).
- الجدولة الموصى بها: كل 4 ساعات عبر cron على الخادم يستدعي نقطة نهاية المنصة بمصادقة مالك المنصة.
- **تدريب استعادة ربع سنوي إلزامي** (التفاصيل في `docs/OPERATIONS.md`): إنشاء نسخة ← التحقق ← مقارنة أعداد الصفوف ← الاستعادة في قاعدة معزولة ← تشغيل مطابقة التقارير (ميزان مراجعة بفرق 0، انحراف مخزون 0، تقييم المخزون = حساب المخزون في دفتر الأستاذ).
- الاستعادة الفعلية للإنتاج عملية يدوية مقصودة بصلاحية مالك المنصة + موافِق ثانٍ ومسجّلة في سجل التدقيق؛ لا توجد استعادة بضغطة زر داخل التطبيق.

---

## 7) التحديث والتراجع

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production build
# 1) خذ نسخة محققة أولًا من وحدة المنصة، وتأكد أن حالتها verified
docker compose -f docker-compose.prod.yml --env-file .env.production up -d   # migrate يعمل تلقائيًا أولًا
```
- الهجرات إضافية فقط؛ لا تُعدّل هجرة مطبّقة أبدًا ولا تُعكَس تلقائيًا.
- التراجع = إعادة نشر الصور السابقة؛ تراجع قاعدة البيانات يتم فقط عبر إجراء الاستعادة الموثق.

---

## 8) ⚠️ ما يجب إغلاقه قبل الإطلاق الإنتاجي الفعلي للعملاء

النظام مكتمل برمجيًا عبر المراحل 0–10 ومُتحقق منه باختبارات تكامل على PostgreSQL حقيقي، لكن النقاط التالية **ليست مُدّعاة ولا يجب تجاوزها** (التفاصيل في `docs/RELEASE_READINESS.md`):

1. **ZATCA**: التكامل مُختبَر عند الحدّ فقط عبر بوابة وهمية. الإرسال الإنتاجي يبقى **معطّلًا** حتى إكمال الانضمام الرسمي للبيئة التجريبية (CSR/CSID) والتحقق من XML وفق المواصفات الرسمية الحالية واعتماد قانوني (الأسئلة المفتوحة Q-001/Q-002/Q-003).
2. **أسئلة قانونية/تجارية مفتوحة** (خصومات الرواتب Q-004، تعدد العملات Q-005، العمولات Q-009، وغيرها في `docs/DECISIONS.md` وقائمة الأسئلة بالوثائق).
3. **Google Drive**: ربط OAuth يحتاج بيانات اعتماد النشر الفعلية.
4. **نسخ إنتاجية معزّزة**: إضافة `pg_dump` + تخزين كائني (S3/Drive) فوق الآلية المدمجة المُختبَرة.
5. **QA متصفح/طباعة/أجهزة**: اختبارات Playwright وطباعة حرارية/A4 وتجربة PWA على أجهزة حقيقية لم تُنفّذ بعد.
6. يوصى ببدء **تشغيل تجريبي داخلي مع مستأجر ودود** بوضع ضريبي غير إنتاجي قبل أي إطلاق عام.

---

## 9) حل المشاكل الشائعة

| العَرَض | السبب المحتمل | الحل |
|---|---|---|
| `migrate` يفشل أو يكرر | متغيرات DB مفقودة في `.env.production` | أعد إنشاء الملف من `.env.production.example` ومرّر `--env-file .env.production` دائمًا، ثم انظر `docker compose -f docker-compose.prod.yml --env-file .env.production logs migrate` |
| `service "migrate" didn't complete successfully` | الهجرات أو إنشاء الدور فشل داخل الحاوية (الإصلاح الحالي: سكربت `apps/api/scripts/migrate-prod.sh` + حزم openssl في الصورة) | حدّث الكود لآخر commit، ثم `docker compose -f docker-compose.prod.yml --env-file .env.production down -v` وأعد البناء `--build` |
| `P1012: Environment variable not found: DATABASE_URL` عند تشغيل Prisma محليًا (Windows مثلًا) | لا يوجد ملف `apps/api/.env` — Prisma لا يقرأ `.env` الجذري تلقائيًا من هذا الموضع | `cd apps/api` ثم `cp .env.example .env` (في Windows: `copy .env.example .env`) وعدّل `DATABASE_URL` ثم أعد الأمر |
| API يعيد 500 بعد الدخول | التطبيق اتصل كمالك DB فتُجاوز RLS أو العكس | تأكد أن `DATABASE_URL` للـ API يستخدم `erp_app` وليس مالك القاعدة |
| تسجيل الدخول 401 دائمًا | `SESSION_SECRET` تغيّر أو كوكيز عبر نطاق مختلف | ثبّت السر، واستخدم HTTPS بنفس النطاق، وتحقق من `WEB_ORIGIN` |
| الواجهة تعمل والـ API لا | خدمة `migrate` لم تنجح أو المنفذ مشغول | `docker compose ... logs migrate api` وغيّر `API_PORT` عند الحاجة |
| النسخة الاحتياطية «failed» | `BACKUP_ENCRYPTION_KEY` أقل من 32 أو Google Drive غير مُكوَّن | هذا فشل صريح مقصود — أكمل التكوين ولا تتجاوزه |

---

## 10) خريطة الوثائق

- `docs/README.md` — فهرس الوثائق التسع عشرة.
- `docs/OPERATIONS.md` — دليل العمليات اليومية والحوادث والاستعادة.
- `docs/RELEASE_READINESS.md` — المُتحقق منه فعليًا مقابل غير المُتحقق (بأدلة CI).
- `docs/PROGRESS.md` — سجل التنفيذ مرحلة بمرحلة مع أرقام تشغيلات CI.
- `docs/SECURITY_AND_TENANCY.md` و `docs/BACKUP_AND_RECOVERY.md` و `docs/INVOICING_AND_ZATCA.md` — سياسات الأمان والعزل والنسخ والفوترة الإلكترونية.
