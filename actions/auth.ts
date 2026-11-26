"use server";
// Email + password sign-in and sign-up. Failures go back to /login?error=<code>.
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";

function read(form: FormData) {
  return { email: String(form.get("email") ?? "").trim().toLowerCase(), password: String(form.get("password") ?? "") };
}

export async function logIn(form: FormData) {
  try {
    await signIn("credentials", { ...read(form), redirectTo: "/" });
  } catch (e) {
    if (e instanceof AuthError) redirect("/login?error=credentials");
    throw e; // the success redirect is thrown too
  }
}

// shortcut: no email verification and no rate limit, add both before giving roles to self-registered accounts on a public URL
export async function signUp(form: FormData) {
  const { email, password } = read(form);
  // 200 cap: scrypt cost grows with input, don't hash megabytes.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 200) redirect("/login?error=invalid");
  // Never set a password on an existing row: that would hand a seeded admin or Google user's roles to whoever asks first.
  if (await prisma.user.findUnique({ where: { email } })) redirect("/login?error=exists");
  await prisma.user.create({ data: { email, passwordHash: hashPassword(password) } });
  await logIn(form);
}
