import { createFileRoute } from "@tanstack/react-router";
import { PricingSubscriptionView } from "@/components/site/PricingSubscriptionView";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "الأسعار والاشتراك السنوي والدفع | Insti DZ" },
      {
        name: "description",
        content:
          "الباقة الأساسية من Insti DZ: باقة واحدة تشمل كل شيء بسعر 9,000 دج سنويًا. الدفع عبر حساب البريد الجاري CCP مع تفعيل الحساب خلال 24 ساعة.",
      },
      { property: "og:title", content: "الأسعار والاشتراك السنوي والدفع | Insti DZ" },
      {
        property: "og:description",
        content: "باقة واحدة بسيطة لكل المؤسسات التعليمية والتكوينية الجزائرية بسعر 9,000 دج سنويًا.",
      },
    ],
  }),
  component: PricingSubscriptionView,
});
