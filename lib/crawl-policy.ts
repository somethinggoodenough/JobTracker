import { isInCrawlWindow, isOlderThanCrawlWindow, publicationTime } from "./crawl-window";
export const UNKNOWN_DATE_LIMIT = 50;
export const hasPublicationDate = (value?: string | null) => Number.isFinite(publicationTime(value));
export const isCrawlCandidate = (value?: string | null) => !hasPublicationDate(value) || isInCrawlWindow(value);
// One selector per adapter invocation, shared across all of that source's pages.
export function createPostingSelection() {
  let unknown = 0;
  return {
    accept(value?: string | null) { return hasPublicationDate(value) ? isInCrawlWindow(value) : unknown++ < UNKNOWN_DATE_LIMIT; },
    stop(dates: (string | null | undefined)[]) {
      return dates.length > 0 && (dates.every(isOlderThanCrawlWindow) || (unknown >= UNKNOWN_DATE_LIMIT && dates.every(date => !hasPublicationDate(date))));
    },
  };
}
export function selectPostingRows<T>(rows: T[], date: (row: T) => string | null | undefined) {
  const selection = createPostingSelection();
  return rows.filter(row => selection.accept(date(row)));
}
