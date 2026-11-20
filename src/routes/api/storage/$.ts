import { createFileRoute } from "@tanstack/react-router";

const INLINE_SAFE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
]);

export const Route = createFileRoute("/api/storage/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const splat = (params as { _splat?: string })._splat || "";
          const slashIdx = splat.indexOf("/");
          if (slashIdx <= 0 || slashIdx === splat.length - 1) {
            return Response.json({ error: "Invalid storage path." }, { status: 400 });
          }

          const bucket = splat.slice(0, slashIdx);
          const rawPath = splat.slice(slashIdx + 1);
          const url = new URL(request.url);
          const expRaw = url.searchParams.get("exp");
          const sig = url.searchParams.get("sig") || "";
          const exp = expRaw ? Number(expRaw) : NaN;

          if (!Number.isFinite(exp) || !sig) {
            return Response.json({ error: "Missing signed URL parameters." }, { status: 403 });
          }

          const { storageAdapter } = await import("@/server/storage/storage.adapter");
          let isValid = false;
          try {
            isValid = storageAdapter.verifySignedUrl(bucket, rawPath, exp, sig);
          } catch {
            return Response.json({ error: "Invalid storage path or bucket." }, { status: 400 });
          }

          if (!isValid) {
            return Response.json({ error: "Invalid or expired download signature." }, { status: 403 });
          }

          const file = await storageAdapter.read(bucket, rawPath);
          if (!file) {
            return Response.json({ error: "File not found." }, { status: 404 });
          }

          const fileName = rawPath.split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
          const disposition = INLINE_SAFE_TYPES.has(file.contentType)
            ? `inline; filename="${fileName}"`
            : `attachment; filename="${fileName}"`;

          return new Response(new Uint8Array(file.data), {
            status: 200,
            headers: {
              "Content-Type": file.contentType,
              "Content-Length": String(file.data.length),
              "X-Content-Type-Options": "nosniff",
              "Content-Disposition": disposition,
              "Cache-Control": "private, max-age=300",
            },
          });
        } catch (err: any) {
          return Response.json(
            { error: err?.message ?? "Failed to retrieve file." },
            { status: 500 },
          );
        }
      },
    },
  },
});
