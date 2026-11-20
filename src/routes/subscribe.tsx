import { createFileRoute } from "@tanstack/react-router";
import { PricingSubscriptionView } from "@/components/site/PricingSubscriptionView";

export const Route = createFileRoute("/subscribe")({
  head: () => ({
    meta: [
      { title: "الاشتراك السنوي والدفع عبر CCP | Insti DZ" },
      {
        name: "description",
        content:
          "ادفع اشتراك Insti DZ السنوي 9,000 دج عبر الحساب البريدي CCP، ثم ارفع وصل الدفع ليتم التحقق وتفعيل حساب مؤسستك خلال 24 ساعة.",
      },
      { property: "og:title", content: "الاشتراك السنوي والدفع عبر CCP | Insti DZ" },
      {
        property: "og:description",
        content: "خطوات الاشتراك: الدفع 9,000 دج عبر CCP، رفع الوصل، ثم التفعيل بعد المراجعة.",
      },
    ],
  }),
  component: PricingSubscriptionView,
});
