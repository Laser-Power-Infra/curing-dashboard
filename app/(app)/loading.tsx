// Skeleton shown while any page loads: never a blank screen (guide 7).
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="animate-pulse space-y-4">
      <div className="h-7 w-48 rounded bg-slate-200" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-lg bg-slate-200" />)}
      </div>
      <div className="h-64 rounded-lg bg-slate-200" />
    </div>
  );
}
