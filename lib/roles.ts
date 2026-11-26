// users.role is plain text so it can be edited by hand in the database: "user" (read only), "admin",
// or several roles separated by commas ("lab, production head"). Unknown words are ignored.
import { Role } from "@/generated/prisma/enums";

export function parseRoles(text: string | null | undefined): Role[] {
  const names = (text ?? "").split(",").map((s) => s.trim().toUpperCase().replace(/[\s-]+/g, "_"));
  return Object.values(Role).filter((r) => r !== "VIEWER" && names.includes(r));
}

export const rolesText = (roles: readonly Role[]) => roles.filter((r) => r !== "VIEWER").join(", ").toLowerCase() || "user";
