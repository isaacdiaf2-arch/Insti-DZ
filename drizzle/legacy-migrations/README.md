# مجلد تاريخي — لا يُشغَّل (Historical Legacy Migrations — Do Not Run)

> **تاريخي، لا يُشغَّل**

هذا المجلد يحتوي على ملفات هجرة قديمة أُرشِفت لأغراض التوثيق التاريخي فقط.
**ممنوع تشغيل `drizzle-kit migrate` أو `drizzle-kit push` أو أي أداة هجرة على هذا المسار.**

المصدر الوحيد المعتمد لهجرات قاعدة بيانات Neon PostgreSQL في الإنتاج والاختبار هو:
`/migrations/0001_*.sql` إلى `/migrations/0010_*.sql`.
