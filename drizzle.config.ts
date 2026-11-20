import { defineConfig } from "drizzle-kit";

// /migrations/0001..0011 is the sole authoritative SQL migration source for Neon.
// Do NOT run `drizzle-kit migrate` or `drizzle-kit push` against archived drizzle/legacy-migrations.
export default defineConfig({
  dialect: "postgresql",
  schema: "./drizzle/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      process.env.TEST_DATABASE_URL ||
      "",
  },
});
