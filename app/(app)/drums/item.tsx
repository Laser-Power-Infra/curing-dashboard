// Item cell of the long lists: item name, item code and the size tag.
// Party has its own column there, so Party and Item can each have a column-header filter.
import { Chip } from "@/components/ui";
import { sizeTag } from "@/lib/format";

export function Item({ name, code }: { name: string | null | undefined; code?: string | null }) {
  if (!name) return <>–</>;
  const size = sizeTag(name);
  return (
    <div className="min-w-40 leading-5">
      <div>{name}</div>
      <div className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
        {code && <span>{code}</span>}
        {size && <Chip tone="blue">{size}</Chip>}
      </div>
    </div>
  );
}
