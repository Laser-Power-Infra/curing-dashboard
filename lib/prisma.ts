// Prisma client for Next.js (App Router) on Neon.
// Uses the POOLED Neon connection string at runtime via the Neon driver adapter.
// One instance is reused across hot reloads in development.
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const READS = ["findMany", "findFirst", "findUnique", "findFirstOrThrow", "findUniqueOrThrow", "count", "groupBy", "aggregate"];
// The Neon connection is a WebSocket; when it drops, the driver throws a bare ErrorEvent, not an Error.
const dropped = (e: unknown) => !(e instanceof Error) || /websocket|connection terminated|connection closed|ECONNRESET|fetch failed/i.test(e.message);

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString }) }).$extends({
    query: {
      // A dropped connection used to fail the whole page ("Couldn't load this page"). Reads are safe to
      // ask again, so they get two more tries; writes are not repeated, they could apply twice.
      async $allOperations({ operation, args, query }) {
        for (let tries = 0; ; tries++) {
          try {
            return await query(args);
          } catch (e) {
            if (tries >= 2 || !READS.includes(operation) || !dropped(e)) throw e;
          }
        }
      },
    },
    // Same client with the retry added; the cast keeps the plain PrismaClient types the rest of the code uses.
  }) as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
