// Run the sheet sync by hand: see services/sheet-sync.ts for the options.
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { sheetSync } from "@/services/sheet-sync";

const args = process.argv.slice(2);
sheetSync({ folder: args.find((a) => !a.startsWith("--")), dryRun: args.includes("--dry-run") })
  .catch((e) => { console.error(`
Import stopped: ${e instanceof Error ? e.message : "The database connection dropped. Run it again: rows already imported are skipped."}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
