import { isInCrawlWindow, isOlderThanCrawlWindow, publicationTime } from "./crawl-window";
import { ID_SCAN_LIMIT, ID_SCAN_PAGES, ledger, observePosting, type DateKind } from "./posting-ledger";
export const UNKNOWN_DATE_LIMIT = 50;
export const hasPublicationDate = (value?: string | null) => Number.isFinite(publicationTime(value));
export const isCrawlCandidate = (value?: string | null, kind: DateKind = "published") =>
  kind !== "published" || !hasPublicationDate(value) || isInCrawlWindow(value);
// One selector per adapter invocation, shared across all of that source's pages.
export function createPostingSelection(track = true) {
  let unknown = 0;
  return {
    accept(value?: string | null, id?: unknown, kind: DateKind = "published") {
      const context = track ? ledger.getStore() : undefined;
      const observation = context && observePosting(context, id);
      if (kind === "published" && hasPublicationDate(value)) return isInCrawlWindow(value);
      if (context && kind === "updated" && publicationTime(value) < Date.now() - 7 * 86_400_000) return false;
      if (observation && (!observation.inRange || observation.duplicate)) return false;
      if (context?.hasSnapshot && observation?.key && context.known.has(observation.key)) return false;
      return unknown++ < UNKNOWN_DATE_LIMIT;
    },
    stop(dates: (string | null | undefined)[], undatedOnly = false) {
      const context = track ? ledger.getStore() : undefined;
      if (context) {
        context.pages++;
        if ((context.rowsSeen >= ID_SCAN_LIMIT || context.pages >= ID_SCAN_PAGES) && dates.some(date => !hasPublicationDate(date))) return true;
      }
      return dates.length > 0 && (!undatedOnly && dates.every(isOlderThanCrawlWindow) ||
        (!context && unknown >= UNKNOWN_DATE_LIMIT && dates.every(date => !hasPublicationDate(date))));
    },
  };
}
export function selectPostingRows<T>(rows: T[], date: (row: T) => string | null | undefined,
  id?: (row: T) => unknown, kind?: (row: T) => DateKind | undefined, track = true) {
  const selection = createPostingSelection(track);
  return rows.filter(row => selection.accept(date(row), id?.(row), kind?.(row)));
}
