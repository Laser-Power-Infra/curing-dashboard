// Prisma 7 config. The Prisma CLI (migrate, seed, studio) uses the DIRECT
// (unpooled) Neon connection. The app at runtime uses the POOLED connection
// through the Neon driver adapter – see src/lib/prisma.ts.
import "dotenv/config";
import { defineConfig } from "prisma/config";

// Neon's direct host is the pooled host without "-pooler", so DIRECT_URL is optional.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL?.replace("-pooler", "");
if (!url) throw new Error("Set DIRECT_URL or DATABASE_URL in .env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: { url },
});
