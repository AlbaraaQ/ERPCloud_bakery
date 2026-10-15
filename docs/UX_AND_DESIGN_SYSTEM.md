# UX & Design System

## 1. Language & direction
Arabic first: `<html lang="ar" dir="rtl">` default; English switches `lang/dir` fully.
i18n resource files per module; **no hard-coded strings** in components; numbers/dates/currency
formatted with tenant config (Arabic-Indic digits optional per tenant setting, default Western
digits for accounting clarity — Q-015). Terminology follows the glossary in `DOMAIN_MODEL.md`.

## 2. Themes & tokens
Design tokens (CSS variables): colour (primary, surface, text, success/warning/danger/info —
status never conveyed by colour alone; always icon + Arabic label), spacing scale, radius,
typography (Arabic font: IBM Plex Sans Arabic or Tajawal — final pick Phase 1, self-hosted),
shadows. Light & dark themes via `data-theme`; POS optimised for both. Minimum contrast WCAG AA
for text; focus-visible outlines; keyboard navigation throughout; POS fully keyboard-operable
(barcode scanner acts as keyboard input).

## 3. Layout & navigation
RTL sidebar (right side) grouped by work: لوحة التحكم، المبيعات، المشتريات، المخزون، الإنتاج،
المحاسبة، النقد والبنوك، المندوبون والتسويات، التقارير، الإعدادات. Role-based menus (server
permissions also enforced). Dashboards per role with actionable cards (pending settlements,
rejected sync ops, low stock, expiring lots, failed tax submissions).
Representative app: bottom navigation (الرئيسية، نقطة البيع، العملاء، العهدة، المزامنة، التسوية),
large touch targets, one-thumb operation, always-visible sync status chip (غير متصل/قيد المزامنة/متزامن/توجد أخطاء).

## 4. Core components (reusable, in `packages/ui` or app components)
DataTable (sort/filter/pagination/saved views), MoneyInput (Decimal-safe, tabular numbers),
QuantityInput (unit selector), ProductPicker (name/SKU/barcode, lot awareness), PartyPicker,
StatusBadge (per status axis), ConfirmationDialog (destructive/financial actions spell out the
effect in plain Arabic: «سيتم ترحيل قيد محاسبي وحركة مخزون…»), Toast + NotificationCenter,
SyncStatusPanel, PrintPreview, Form primitives with inline Arabic validation messages
(actionable: say what to fix and where), Empty/Loading/Offline/Error states for every screen.

## 5. Documents & print
Configurable templates (logo, legal identity, tax number); customer copy vs acknowledgment copy
(signature lines); sale datetime + print datetime printed distinctly; draft watermark
«مسودة — ليست فاتورة ضريبية»; free-qty column; payment breakdown + remaining balance;
original-document reference on returns/notes; Arabic text rendering verified in PDF export
(shaping/RTL tested with real Arabic strings in E2E).

## 6. POS speed rules
Default focus in search; Enter flows qty→price→add; customer defaults applied automatically;
totals recomputed by server response on save (client totals are display-only estimates labelled
as such offline). Save dialog exactly as `INVOICING_AND_ZATCA.md` §3.

## 7. Accessibility & devices
Responsive desktop/tablet/mobile breakpoints; font scaling respected; labels on all inputs;
error summary focus management; tested with keyboard-only flow for invoice creation.
