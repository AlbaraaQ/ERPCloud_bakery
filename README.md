# ERPCloud — نظام محاسبة وتشغيل سحابي متعدد المستأجرين

نظام ERP عربي أولًا (RTL) للشركات الصغيرة والمتوسطة في التصنيع الغذائي والتوزيع والمبيعات المتنقلة:
محاسبة مزدوجة القيد، مخزون وتكاليف، تصنيع (BOM)، مبيعات ونقاط بيع، عهدة وتسوية مناديب مبيعات
مع مزامنة غير متصلة، تقارير مالية مطابقة للدفاتر، امتثال ضريبي ZATCA عبر بوابة تكامل،
وحدة منصّة SaaS، ومساعد ذكاء اصطناعي مقيّد بالصلاحيات.

## التشغيل السريع (إنتاجي عبر Docker)

```bash
cp .env.production.example .env.production   # املأ كل القيم (openssl rand -hex 32 للأسرار)
# لأول مرة فقط: اجعل RUN_SEED=true في .env.production لإنشاء أول مستأجر ومالكه
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
curl http://localhost:3001/api/v1/health     # {"status":"ok"}
# الواجهة: http://localhost:8080
```

**الدليل الكامل بالعربية: [`docs/DEPLOYMENT_GUIDE_AR.md`](docs/DEPLOYMENT_GUIDE_AR.md)** —
يشمل المتطلبات، متغيرات البيئة، أول تشغيل، HTTPS، النسخ الاحتياطي والاستعادة، التحديث والتراجع،
حل المشاكل، وما يجب إغلاقه قبل الإطلاق الفعلي (ZATCA والاعتمادات القانونية).

## التطوير المحلي

```bash
npm ci && npm run build -w @erpcloud/shared
docker compose up -d db
cd apps/api && npx prisma generate && npx prisma migrate deploy
npm run start:dev -w @erpcloud/api   # :3001/api/v1
npm run dev -w @erpcloud/web         # :5173
```

## التحقق

```bash
npm run build && npm run typecheck && npm test
```

وثائق المشروع كاملة (19 ملفًا + أدلة التشغيل): [`docs/README.md`](docs/README.md) ·
حالة التنفيذ والأدلة: [`docs/PROGRESS.md`](docs/PROGRESS.md) ·
جاهزية الإطلاق: [`docs/RELEASE_READINESS.md`](docs/RELEASE_READINESS.md)
