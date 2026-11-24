"use client";
// Plain-language error state with a retry: no raw error codes (guide 7).
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-white p-8 text-center">
      <p className="text-sm text-slate-800">Couldn&apos;t load this page.</p>
      <button onClick={reset} className="mt-3 min-h-11 rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800">
        Retry
      </button>
    </div>
  );
}
