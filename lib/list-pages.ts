import { mapPool } from "./crawler-http";

// Only for independent page numbers with a reported total. Yield in board order
// so the first fifty undated records remain deterministic.
export async function* numberedPages<T>(
  load: (page: number) => Promise<{ rows: T[]; total: number }>, size: number, maximum: number,
  complete?: () => void,
) {
  const first = await load(1);
  yield first.rows;
  if (first.rows.length < size) { complete?.(); return; }
  const knownTotal = Number.isFinite(first.total) && first.total >= 0;
  let total = first.total;
  const step = knownTotal ? 2 : 1;
  const lastPage = () => knownTotal ? Math.min(maximum, Math.ceil(total / size)) : maximum;
  for (let page = 2; page <= lastPage(); page += step) {
    const pages = Array.from({ length: Math.min(step, lastPage() - page + 1) }, (_, i) => page + i);
    for (const { rows, total: reported } of await mapPool(pages, load, step)) {
      if (knownTotal && Number.isFinite(reported)) total = Math.max(total, reported);
      yield rows;
      if (rows.length < size) { complete?.(); return; }
    }
  }
  if (!knownTotal || total > maximum * size) throw new Error("招聘列表分页超过上限");
  complete?.();
}
