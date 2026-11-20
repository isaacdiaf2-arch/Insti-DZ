# Insti DZ — نظام إدارة المؤسسات التعليمية والتكوينية

منصة **Insti DZ** (Modular Monolith + Service Layer + Repository Pattern) مبنية باستخدام TanStack Start وReact وTypeScript، وتعتمد حصرياً على **PostgreSQL (Neon)** عبر **Drizzle ORM**.

## قاعدة البيانات والمهاجرات

- المسار المعتمد للمهاجرات: `/migrations/0001` حتى `/migrations/0011` (يُدار يدوياً عبر SQL، ولا يُشغّل `drizzle-kit push/migrate` في الإنتاج لحماية أدوار وواجهات RLS).
- راجع `.env.example` لتهيئة المتغيرات الإلزامية (`DATABASE_URL`، `AUTH_SECRET`، `STORAGE_SIGNING_SECRET`، `ACTIVITY_LOG_PIN`، وإعدادات `S3_*` و`PUBLIC_URL`).

## الأوامر الأساسية

```bash
npm run dev        # تشغيل خادم التطوير على المنفذ 3000
npm run typecheck  # فحص TypeScript
npm run lint       # فحص ESLint
npm run test       # تشغيل اختبارات Vitest
npm run build      # بناء نسخة الإنتاج
npm run start      # تشغيل خادم الإنتاج (.output/server/index.mjs)
```