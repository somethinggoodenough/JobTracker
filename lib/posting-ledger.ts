import { AsyncLocalStorage } from "node:async_hooks";
import { dayWindow, publicationTime } from "./crawl-window";
import { throwIfSyncCancelled } from "./sync-control";

export const NEW_GAP_HOURS = 36;
export const ID_SCAN_LIMIT = 300;
export const ID_SCAN_PAGES = 20;
const HOUR = 3_600_000;
const WEEK = 7 * 24 * HOUR;
export type DateKind = "published" | "updated" | "listed";
export type Freshness = "published" | "new" | "uncertain" | "baseline";
export type FreshnessReason = "gap" | "scan_range" | "other_source" | "listing_date" | "legacy" | "untracked";
export type FreshnessResult = { freshness: Freshness; appearedAfter: string | null; reason: FreshnessReason | null };
type Observation = { key: string; position: number };
export type PostingSnapshot = { crawled_at: string; observed_count: number; scan_complete: number };
export type PostingScan = { observed: Observation[]; rowsSeen: number; pages: number; scanComplete: boolean; untracked: boolean };
export type LedgerContext = PostingScan & { known: Set<string>; hasSnapshot: boolean; positions: Map<string, number> };
export const ledger = new AsyncLocalStorage<LedgerContext>();

export const normalizePostingKey = (value: unknown) => value == null ? "" :
  String(value).toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();

export function postingContext(known: Iterable<string> = [], hasSnapshot = false): LedgerContext {
  return { known: new Set(known), hasSnapshot, positions: new Map(), observed: [], rowsSeen: 0, pages: 0, scanComplete: false, untracked: false };
}

export function observePosting(context: LedgerContext, identity: unknown) {
  const key = normalizePostingKey(identity);
  const position = context.rowsSeen++;
  const old = context.positions.get(key);
  if (old !== undefined) return { key, duplicate: true, inRange: position < ID_SCAN_LIMIT };
  if (!key) context.untracked = true;
  if (key && position < ID_SCAN_LIMIT) {
    context.positions.set(key, position);
    context.observed.push({ key, position });
  }
  return { key, duplicate: false, inRange: position < ID_SCAN_LIMIT };
}

export function completePostingScan() {
  const context = ledger.getStore();
  if (context && !context.untracked && context.rowsSeen <= ID_SCAN_LIMIT && context.pages <= ID_SCAN_PAGES) context.scanComplete = true;
}

export function copyPostingScan(context: LedgerContext, scan: PostingScan) {
  context.observed = scan.observed.slice(0, ID_SCAN_LIMIT);
  context.positions = new Map(context.observed.map(({ key, position }) => [key, position]));
  context.rowsSeen = scan.rowsSeen;
  context.pages = scan.pages;
  context.scanComplete = scan.scanComplete;
  context.untracked = scan.untracked;
}

export function classifyFreshness(input: {
  key: string; position?: number; dateKind?: DateKind; date?: string | null; known: ReadonlySet<string>;
  prev?: PostingSnapshot | null; now: number; firstSeenElsewhere?: string | null; existing?: FreshnessResult | null;
}): FreshnessResult | null {
  const { date, dateKind = "published", now, prev, known, key, position, firstSeenElsewhere, existing } = input;
  const time = publicationTime(date);
  const gap = NEW_GAP_HOURS * HOUR;
  function result(freshness: Freshness, appearedAfter: string | null = null, reason: FreshnessReason | null = null): FreshnessResult {
    return { freshness, appearedAfter, reason };
  }
  if (dateKind === "published" && Number.isFinite(time)) return result("published");
  if (dateKind === "updated" && time < now - WEEK) return null;
  if (dateKind === "listed" && Number.isFinite(time)) {
    if (time < now - WEEK) return result("baseline");
    return time <= now && now - time <= gap ? result("new", new Date(time).toISOString()) :
      result("uncertain", prev?.crawled_at ?? null, "listing_date");
  }
  if (known.has(key)) return existing ?? result("baseline");
  if (!prev) return result("baseline");
  if (!key || position === undefined) return result("uncertain", prev.crawled_at, "untracked");
  if (firstSeenElsewhere && Date.parse(firstSeenElsewhere) < now - gap) return result("uncertain", prev.crawled_at, "other_source");
  if (!prev.scan_complete && position >= prev.observed_count) return result("uncertain", prev.crawled_at, "scan_range");
  const elapsed = now - Date.parse(prev.crawled_at);
  if (elapsed > WEEK) return result("baseline");
  if (elapsed > gap) return result("uncertain", prev.crawled_at, "gap");
  return result("new", prev.crawled_at);
}

export const freshnessRank: Record<Freshness, number> = { published: 4, new: 3, uncertain: 2, baseline: 1 };

export async function readPostingLedger(db: D1Database, sourceId: number) {
  const [keys, prev] = await Promise.all([
    db.prepare("SELECT posting_key FROM source_postings WHERE source_id=?1").bind(sourceId).all<{ posting_key: string }>(),
    db.prepare(`SELECT crawled_at,observed_count,scan_complete FROM source_snapshots WHERE source_id=?1 AND status='success'
      ORDER BY crawled_at DESC,id DESC LIMIT 1`).bind(sourceId).first<PostingSnapshot>(),
  ]);
  return { context: postingContext(keys.results.map(row => row.posting_key), !!prev), prev };
}

export async function savePostingSnapshot(db: D1Database, sourceId: number, runId: number, stamp: string,
  context: PostingScan | undefined, status: "success" | "partial" | "failed") {
  const statements = [];
  if (status !== "failed" && context?.observed.length) {
    statements.push(db.prepare(`INSERT INTO source_postings(source_id,posting_key,first_seen_at,last_seen_at,last_position,first_run_id)
      SELECT ?1,json_extract(value,'$.key'),?2,?2,json_extract(value,'$.position'),?3 FROM json_each(?4)
      WHERE EXISTS(SELECT 1 FROM scrape_runs WHERE id=?3 AND status='running') AND EXISTS(SELECT 1 FROM sources WHERE id=?1)
      ON CONFLICT(source_id,posting_key) DO UPDATE SET last_seen_at=excluded.last_seen_at,last_position=excluded.last_position`)
      .bind(sourceId, stamp, runId, JSON.stringify(context.observed)));
  }
  statements.push(db.prepare(`INSERT INTO source_snapshots(source_id,run_id,crawled_at,observed_count,scan_complete,status)
    SELECT ?1,?2,?3,?4,?5,?6 WHERE EXISTS(SELECT 1 FROM scrape_runs WHERE id=?2 AND status='running')
      AND EXISTS(SELECT 1 FROM sources WHERE id=?1)
    ON CONFLICT(source_id,run_id) DO UPDATE SET crawled_at=excluded.crawled_at,observed_count=excluded.observed_count,
      scan_complete=excluded.scan_complete,status=excluded.status`)
    .bind(sourceId, runId, stamp, Math.min(context?.rowsSeen ?? 0, ID_SCAN_LIMIT), context?.scanComplete ? 1 : 0, status));
  await db.batch(statements);
}

export async function backfillPostingLedger(db: D1Database) {
  const pending = await db.prepare("SELECT 1 FROM jobs WHERE freshness_reason='legacy_pending' LIMIT 1").first();
  if (!pending) return;
  const firstBySource = await db.prepare("SELECT source_id,MIN(first_seen_at) AS first FROM jobs GROUP BY source_id")
    .all<{ source_id: number; first: string }>();
  const nyDate = (iso: string) => dayWindow(new Date(iso)).date;
  const firstDays = new Map(firstBySource.results.map(row => [row.source_id, nyDate(row.first)]));
  for (;;) {
    throwIfSyncCancelled();
    const { results } = await db.prepare(`SELECT id,source_id,source_external_key,canonical_url,first_seen_at,last_seen_at,publication_verified
      FROM jobs WHERE freshness_reason='legacy_pending' ORDER BY id LIMIT 32`).all<{
        id: number; source_id: number; source_external_key: string; canonical_url: string; first_seen_at: string; last_seen_at: string; publication_verified: number;
      }>();
    if (!results.length) return;
    await db.batch(results.flatMap(row => {
      const key = normalizePostingKey(row.source_external_key.replace(/^\d+:/, "") || row.canonical_url);
      const freshness = row.publication_verified ? "published" :
        firstDays.get(row.source_id) === nyDate(row.first_seen_at) ? "baseline" : "uncertain";
      return [
        db.prepare(`INSERT OR IGNORE INTO source_postings(source_id,posting_key,first_seen_at,last_seen_at,last_position)
          VALUES (?1,?2,?3,?4,0)`).bind(row.source_id, key, row.first_seen_at, row.last_seen_at),
        db.prepare("UPDATE jobs SET freshness=?2,freshness_reason=?3 WHERE id=?1 AND freshness_reason='legacy_pending'")
          .bind(row.id, freshness, freshness === "uncertain" ? "legacy" : null),
      ];
    }));
  }
}
