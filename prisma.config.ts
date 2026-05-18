
import "dotenv/config";
import { defineConfig } from "prisma/config";

// DATABASE_URL is read from the schema (env("DATABASE_URL")) at client
// runtime, not here. That keeps `prisma generate` working in CI/build
// contexts that have no DB credentials.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  engine: "classic",
});
