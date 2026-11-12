// Independent Neon / Drizzle adapter bridge for server-side operations
// This completely decouples all server operations from Supabase.
import { getServiceDb, type DbClient } from "@/server/db/adapter";

export const supabaseAdmin = new Proxy({} as any, {
  get(_, prop, receiver) {
    const db = getServiceDb();
    const val = Reflect.get(db as any, prop, receiver);
    if (typeof val === "function") {
      return val.bind(db);
    }
    return val;
  },
});
