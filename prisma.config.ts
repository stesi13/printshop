
import "dotenv/config";
import { defineConfig } from "prisma/config";

// DATABASE_URL is read from the schema (env("DATABASE_URL")) by the
// Prisma client at runtime, not at config-load time. That keeps
// `prisma generate` working in CI/build contexts that have no DB
// credentials. The "classic" engine path requires a datasource at the
// config level, so we leave engine unset and let Prisma resolve it
// from the schema.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
