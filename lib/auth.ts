// Sign-in (email + password, plus Google for company accounts when configured) and role checks (guide 11).
import { cache } from "react";
import { redirect } from "next/navigation";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import type { Role } from "@/generated/prisma/enums";

/** Google sign-in is optional: it is offered only when its credentials are in the environment. */
export const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    ...(googleEnabled ? [Google] : []),
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(c) {
        const email = String(c?.email ?? "").trim().toLowerCase();
        const row = email ? await prisma.user.findUnique({ where: { email } }) : null;
        if (!row?.passwordHash || !row.active || !verifyPassword(String(c?.password ?? ""), row.passwordHash)) return null;
        return { id: row.id, email: row.email, name: row.name };
      },
    }),
  ],
  // Own cookie name: browsers share cookies across ports, so another Auth.js app on the same host
  // would otherwise hand us a session token we cannot decrypt (JWTSessionError).
  cookies: { sessionToken: { name: "curing.session-token" } },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    signIn({ account, profile }) {
      if (account?.provider !== "google") return true; // password already checked in authorize
      const domain = process.env.AUTH_ALLOWED_DOMAIN?.toLowerCase();
      const email = profile?.email?.toLowerCase();
      // No domain configured = nobody gets in, rather than everybody.
      return Boolean(domain && email && profile?.email_verified && email.endsWith(`@${domain}`));
    },
  },
});

export type SessionUser = { email: string; name: string; roles: Role[] };

/** Who may do what. Screens and server actions both check against this one table. */
export const PERMS = {
  unloadEntry: ["CURING", "PLANNING", "PRODUCTION_HEAD", "ADMIN"],
  curingEntry: ["CURING", "PRODUCTION_HEAD", "ADMIN"],
  trackerRemarks: ["CURING", "PRODUCTION_HEAD", "ADMIN"],
  mdRemarks: ["MD"],
  resolveDataError: ["PRODUCTION_HEAD", "ADMIN"],
  testEntry: ["LAB", "PRODUCTION_HEAD", "ADMIN"],
  boilerEntry: ["BOILER", "PRODUCTION_HEAD", "ADMIN"],
  transfer: ["TRANSFER", "PRODUCTION_HEAD", "ADMIN"],
  masters: ["PRODUCTION_HEAD", "PLANNING", "ADMIN"],
  approveRecipe: ["PRODUCTION_HEAD"],
  settings: ["ADMIN"],
} as const satisfies Record<string, readonly Role[]>;
export type Perm = keyof typeof PERMS;

export const getUser = cache(async (): Promise<SessionUser | null> => {
  // Local development only: lets the app run before Google credentials exist.
  if (process.env.NODE_ENV !== "production" && process.env.DEV_USER_EMAIL) {
    const roles = (process.env.DEV_USER_ROLES ?? "ADMIN,PRODUCTION_HEAD").split(",").map((r) => r.trim()) as Role[];
    return { email: process.env.DEV_USER_EMAIL.toLowerCase(), name: "Dev user", roles };
  }
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;
  const row = await prisma.user.findUnique({ where: { email } });
  if (row && !row.active) return null;
  // Accounts with no roles yet (self sign-up, or a company Google account not in the table) are read-only viewers.
  return { email, name: row?.name ?? session?.user?.name ?? email, roles: row?.roles.length ? row.roles : ["VIEWER"] };
});

const GUEST: SessionUser = { email: "", name: "Guest", roles: ["VIEWER"] };

/** For pages: everyone may read, so someone who is not signed in is a read-only guest. */
export const viewer = async (): Promise<SessionUser> => (await getUser()) ?? GUEST;

/** Holds a real role. Sign-up is open, so VIEWER-only accounts are treated like the public. */
export const isStaff = (user: SessionUser) => user.roles.some((r) => r !== "VIEWER");

export const can =(user: SessionUser | null, perm: Perm) =>
  Boolean(user?.roles.some((r) => (PERMS[perm] as readonly Role[]).includes(r)));

/** For server actions: redirects to the sign-in page when nobody is signed in. */
export async function requireUser(): Promise<SessionUser> {
  return (await getUser()) ?? redirect("/login");
}

/** For server actions: throws a plain-language error when the user may not do this. */
export async function requirePerm(perm: Perm): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user, perm)) throw new Error("You don't have permission to do this.");
  return user;
}
