import { createFileRoute } from "@tanstack/react-router";
import { getServiceDb, verifyDatabaseConnection } from "@/server/db/adapter";

export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          await verifyDatabaseConnection();
          const db = await getServiceDb();
          const { error } = await db.from("institutions").select("id").limit(1).maybeSingle();
          if (error) {
            console.error("[Health] Database probe query error:", error.message);
            return Response.json(
              { status: "degraded", database: "error" },
              { status: 503 },
            );
          }
          return Response.json({ status: "ok", database: "connected" });
        } catch (err: any) {
          console.error("[Health] PostgreSQL connection check failed:", err?.message ?? err);
          return Response.json(
            { status: "error", database: "unreachable" },
            { status: 503 },
          );
        }
      },
    },
  },
});
