import type { JobRecord, SourceRecord } from "./job-types";
import { AI_POLICY, CLASSIFIER_VERSION, type JobDecision } from "./classification-types";
import { AwaitingClassification, createJobClassifier } from "./job-classifier";
import { candidateWrite, candidateDelete } from "./job-candidates";
import { SHORTLIST_VERSION } from "./local-shortlist";
import { screeningIdentity } from "./screening-context";
import { hasPublicationDate } from "./crawl-policy";
import { isInCrawlWindow, publicationTime } from "./crawl-window";
import { throwIfSyncCancelled } from "./sync-control";
const DAY = 86_400_000;
const normalize = (value: string | null | undefined) =>
  (value ?? "").toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();

export function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    // Moka and other SPA boards put the posting identity in the route fragment.
    const mihoyoPosting = url.hostname === "jobs.mihoyo.com" && /^#\/position\/\d+$/.test(url.hash);
    if (!mihoyoPosting && !/^#\/(?:job\/|campus\/)/.test(url.hash)) url.hash = "";
    [...url.searchParams.keys()].forEach((key) => {
      if (/^(utm_|source$|ref$|gh_src$)/i.test(key)) url.searchParams.delete(key);
    });
    return url.toString().replace(/\/$/, "");
  } catch { return value.trim(); }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function seedDiscoveries(db: D1Database) {
  throwIfSyncCancelled();
  const rows = await db.prepare(`SELECT canonical_url,dedupe_key,first_seen_at FROM jobs j WHERE NOT EXISTS
    (SELECT 1 FROM job_discoveries d WHERE d.identity='fingerprint:'||j.dedupe_key)`).all<{ canonical_url: string; dedupe_key: string; first_seen_at: string }>();
  for (let offset=0;offset<rows.results.length;offset+=40) {
    const entries = await Promise.all(rows.results.slice(offset,offset+40).map(async row => [
      { identity: `url:${await sha256(canonicalUrl(row.canonical_url))}`, firstSeen: row.first_seen_at },
      { identity: `fingerprint:${row.dedupe_key}`, firstSeen: row.first_seen_at },
    ]));
    throwIfSyncCancelled();
    await db.batch(entries.flat().map(entry => db.prepare("INSERT OR IGNORE INTO job_discoveries(identity,first_seen_at) VALUES(?1,?2)").bind(entry.identity,entry.firstSeen)));
  }
}

type Entry = { job: JobRecord; approved?: JobDecision; originalFirstSeen?: string; historical?: boolean };
type Result = { state: "ignored" | "queued" | "added" | "updated" | "unchanged"; deleted: number };
type Stored = { id: number; posted_at: string; first_seen_at: string; publication_verified: number; crawl_hash: string | null; ai_policy: string | null };

export async function upsertJob(db: D1Database, source: SourceRecord, job: JobRecord, now: string, cutoff: number,
  classifier: ReturnType<typeof createJobClassifier>, model: string, approved?: JobDecision, originalFirstSeen?: string, historical = false) {
  const [result] = await persistJobs(db, source, [{ job, approved, originalFirstSeen, historical }], now, cutoff, classifier, model);
  return result;
}

export function upsertJobs(db: D1Database, source: SourceRecord, jobs: JobRecord[], now: string, cutoff: number,
  classifier: ReturnType<typeof createJobClassifier>, model: string) {
  return persistJobs(db, source, jobs.map(job => ({ job })), now, cutoff, classifier, model);
}

// Callers serialize batches to keep decisions based on the same rows they commit.
async function persistJobs(db: D1Database, source: SourceRecord, entries: Entry[], now: string, cutoff: number,
  classifier: ReturnType<typeof createJobClassifier>, model: string): Promise<Result[]> {
  if (!entries.length) return [];
  if (entries.length > 12) throw new Error("职位写入批次最多 12 条");
  throwIfSyncCancelled();
  const identities = await Promise.all(entries.map(async ({ job }) => {
    const url = canonicalUrl(job.canonicalUrl || job.applyUrl || source.url);
    const sourceKey = `${source.id}:${normalize(job.externalId || url)}`;
    const dedupe = await sha256([job.company || source.name, job.title, job.location, job.department, job.employmentType].map(normalize).join("|"));
    return { url, sourceKey, dedupe, discoveries: [`url:${await sha256(url)}`, `fingerprint:${dedupe}`] };
  }));
  const keyRows = identities.map(() => "(?,?,?,?)").join(",");
  const lookup = await db.prepare(`WITH incoming(n,source_key,url,dedupe) AS (VALUES ${keyRows})
    SELECT incoming.n,j.id,j.first_seen_at,j.posted_at,j.publication_verified,j.crawl_hash,j.ai_policy
      FROM incoming JOIN jobs j ON j.source_external_key=incoming.source_key OR j.canonical_url=incoming.url OR j.dedupe_key=incoming.dedupe
      ORDER BY j.id`).bind(...identities.flatMap((k, i) => [i, k.sourceKey, k.url, k.dedupe])).all<Stored & { n: number }>();
  const keys = identities.flatMap(k => [k.sourceKey, ...k.discoveries]);
  const matched = lookup.results.map(row => row.id);
  if (entries.length > 1 && (new Set(keys).size !== keys.length || new Set(matched).size !== matched.length)) {
    const results: Result[] = [];
    for (const entry of entries) results.push(...await persistJobs(db, source, [entry], now, cutoff, classifier, model));
    return results;
  }
  const existingRows = new Map<number, Stored>();
  for (const row of lookup.results) if (!existingRows.has(row.n)) existingRows.set(row.n, row);
  const discoveryKeys = [...new Set(identities.flatMap(k => k.discoveries))];
  const discoveries = new Map((await db.prepare(`SELECT identity,first_seen_at FROM job_discoveries
    WHERE identity IN (${discoveryKeys.map(() => "?").join(",")})`).bind(...discoveryKeys)
    .all<{ identity: string; first_seen_at: string }>()).results.map(row => [row.identity, row.first_seen_at]));
  const policy = screeningIdentity(classifier.settings);
  const statements: D1PreparedStatement[] = [];
  const results: Result[] = [];
  const deletions: [number, Result][] = [];

  for (const [i, entry] of entries.entries()) {
    throwIfSyncCancelled();
    const { job, approved, originalFirstSeen, historical } = entry;
    const { url, sourceKey, dedupe, discoveries: identityKeys } = identities[i];
    const existing = existingRows.get(i);
    const result: Result = { state: "ignored", deleted: 0 };
    results.push(result);
    const time = publicationTime(job.postedAt);
    const dated = hasPublicationDate(job.postedAt);
    if (dated && time <= cutoff) {
      deletions.push([statements.length, result]);
      statements.push(db.prepare("DELETE FROM jobs WHERE source_external_key=? OR canonical_url=?").bind(sourceKey, url));
      continue;
    }
    if (!historical && dated && !isInCrawlWindow(job.postedAt)) continue;
    const firstSeen = [existing?.first_seen_at || originalFirstSeen || now, ...identityKeys.map(key => discoveries.get(key))]
      .filter((date): date is string => !!date).sort()[0];
    for (const key of identityKeys) {
      if (discoveries.get(key) === firstSeen) continue;
      statements.push(db.prepare(`INSERT INTO job_discoveries(identity,first_seen_at) VALUES(?,?)
        ON CONFLICT(identity) DO UPDATE SET first_seen_at=MIN(job_discoveries.first_seen_at,excluded.first_seen_at)`).bind(key, firstSeen));
    }
    const verified = dated || !!existing?.publication_verified;
    const postedAt = dated ? new Date(time).toISOString() : existing?.publication_verified ? existing.posted_at : firstSeen;
    const remove = () => {
      if (existing) {
        deletions.push([statements.length, result]);
        statements.push(db.prepare("DELETE FROM jobs WHERE id=?").bind(existing.id));
      }
      statements.push(candidateDelete(db, url, dedupe));
    };
    if (Date.parse(postedAt) <= cutoff) { remove(); continue; }

    const values = [source.id, sourceKey, dedupe, url, job.applyUrl || url, job.company || source.name,
      job.title, job.location || "未注明", job.workplaceType || null, job.employmentType || null,
      job.department || null, job.salary || null, job.description || "", postedAt];
    const hash = () => sha256(JSON.stringify([CLASSIFIER_VERSION, SHORTLIST_VERSION, policy, model, verified, ...values]));
    let crawlHash: string | undefined;
    if (!approved && existing?.ai_policy === AI_POLICY && existing.crawl_hash) {
      crawlHash = await hash();
      if (existing.crawl_hash === crawlHash) {
        statements.push(db.prepare("UPDATE jobs SET last_seen_at=?1 WHERE id=?2").bind(now, existing.id));
        result.state = "unchanged";
        classifier.metrics.cacheHits++;
        continue;
      }
    }
    let decision: JobDecision;
    try { decision = approved ?? await classifier.evaluate(job, { cacheOnly: true }); }
    catch (error) {
      if (!(error instanceof AwaitingClassification)) throw error;
      if (existing?.ai_policy) statements.push(db.prepare("UPDATE jobs SET ai_policy=NULL WHERE id=?").bind(existing.id));
      statements.push(await candidateWrite(db, source, job, url, dedupe, firstSeen,
        new Date(Date.parse(postedAt) + 7 * DAY).toISOString(), error.priority, model, classifier.settings));
      result.state = "queued";
      continue;
    }
    if (!decision.accepted) { remove(); continue; }
    const analysis = [AI_POLICY, JSON.stringify(decision), model, new Date().toISOString(), verified ? 1 : 0, crawlHash ?? await hash()];
    if (existing) {
      statements.push(db.prepare(`UPDATE jobs SET source_id=?1, source_external_key=?2, dedupe_key=?3,
        canonical_url=?4, apply_url=?5, company=?6, title=?7, location=?8, workplace_type=?9,
        employment_type=?10, department=?11, salary=?12, description=?13, posted_at=?14,
        last_seen_at=?15, updated_at=?15, ai_policy=?16,ai_analysis=?17,ai_model=?18,
        ai_reviewed_at=?19,publication_verified=?20,crawl_hash=?21 WHERE id=?22`).bind(...values, now, ...analysis, existing.id));
    } else {
      statements.push(db.prepare(`INSERT INTO jobs (source_id,source_external_key,dedupe_key,canonical_url,
        apply_url,company,title,location,workplace_type,employment_type,department,salary,description,posted_at,
        last_seen_at,updated_at,ai_policy,ai_analysis,ai_model,ai_reviewed_at,publication_verified,crawl_hash,first_seen_at)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?15,?16,?17,?18,?19,?20,?21,?22)`)
        .bind(...values, now, ...analysis, firstSeen));
    }
    statements.push(candidateDelete(db, url, dedupe));
    result.state = existing ? "updated" : "added";
  }
  throwIfSyncCancelled();
  const written = statements.length ? await db.batch(statements) : [];
  for (const [index, result] of deletions) result.deleted = written[index]?.meta.changes ?? 0;
  return results;
}
