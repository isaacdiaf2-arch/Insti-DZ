import { createFileRoute } from "@tanstack/react-router";
import { getServiceDb } from "@/server/db/adapter";

export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const db = await getServiceDb();
          const { error } = await db.from("institutions").select("id").limit(1).maybeSingle();
          if (error) {
            return Response.json(
              { status: "degraded", database: "error", error: error.message },
              { status: 503 },
            );
          }
          return Response.json({ status: "ok", database: "connected" });
        } catch {
          return Response.json({ status: "error", database: "unreachable" }, { status: 503 });
        }
      },
    },
  },
});
