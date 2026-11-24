import { signIn } from "@/lib/auth";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 text-center">
        <h1 className="text-xl font-semibold text-slate-900">Curing Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">Laser Power &amp; Infra · Kharagpur</p>
        {error && (
          <p role="alert" className="mt-4 text-sm font-medium text-red-700">
            Couldn&apos;t sign you in. Use your company Google account.
          </p>
        )}
        <form action={async () => { "use server"; await signIn("google", { redirectTo: "/" }); }}>
          <button className="mt-6 min-h-11 w-full rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800">
            Sign in with Google
          </button>
        </form>
      </div>
    </main>
  );
}
