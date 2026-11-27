import Link from "next/link";
import { googleEnabled, signIn } from "@/lib/auth";
import { logIn, signUp } from "@/actions/auth";

const ERRORS: Record<string, string> = {
  credentials: "Wrong email or password.",
  invalid: "Enter a valid email and a password of at least 8 characters.",
  exists: "This email is already registered. Sign in instead, or ask an Admin if you have no password.",
};

const input = "mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 text-base";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6">
        <h1 className="text-center text-xl font-semibold text-slate-900">Curing Dashboard</h1>
        <p className="mt-1 text-center text-sm text-slate-600">Laser Power &amp; Infra · Kharagpur</p>
        {error && (
          <p role="alert" className="mt-4 text-sm font-medium text-red-700">
            {ERRORS[String(error)] ?? "Couldn't sign you in. Please try again."}
          </p>
        )}
        <form className="mt-6 grid gap-3">
          <label className="text-sm font-medium text-slate-800">
            Email
            <input name="email" type="email" required autoComplete="email" className={input} />
          </label>
          <label className="text-sm font-medium text-slate-800">
            Password
            <input name="password" type="password" required minLength={8} maxLength={200} autoComplete="current-password" className={input} />
          </label>
          <button formAction={logIn} className="min-h-11 w-full rounded-md bg-blue-700 px-4 text-sm font-medium text-(--on-solid) hover:bg-blue-800">
            Sign in
          </button>
          <button formAction={signUp} className="min-h-11 w-full rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-100">
            Create account
          </button>
          <p className="text-xs text-slate-600">New here? Enter your email, choose a password of 8 or more characters, then Create account. New accounts can read; an Admin gives you entry rights.</p>
        </form>
        {googleEnabled && (
          <form action={async () => { "use server"; await signIn("google", { redirectTo: "/" }); }}>
            <button className="mt-3 min-h-11 w-full rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-100">
              Sign in with Google
            </button>
          </form>
        )}
        <p className="mt-4 text-center text-sm">
          <Link href="/" className="text-blue-700 underline">Continue without signing in</Link>
        </p>
      </div>
    </main>
  );
}
