import { runSync } from "../../lib/sync";
import { crawlForSync } from "../../lib/local-crawl-client";
import { detailCache, mapDetails } from "../../lib/detail-cache";
import type { JobRecord } from "../../lib/job-types";
import profiles from "../../data/company-adapters.json";
import { POST as streamSync } from "../../app/api/sync/route";
import { GET as progress } from "../../app/api/sync/progress/route";
import { SYNC_HEARTBEAT_SOURCE } from "../../lib/sync-lifecycle";
import registry from "../../data/source-registry.json";
import { POST as verifySource } from "../../app/api/sources/[id]/route";

type FixtureEnv = { DB: D1Database; FIXTURE_PORT: string; FIXTURE_MODE: "direct" | "local" | "run" | "restart" | "disconnect" | "workday" };

export default {
  async fetch(request: Request, env: FixtureEnv, context: ExecutionContext) {
    const route = new URL(request.url).pathname;
    const { DB: db, FIXTURE_MODE: mode } = env;
    if (route === "/health") return new Response("ok");
    if (route === "/setup" && request.method === "POST") {
      const migrations = await request.json() as string[][];
      for (const migration of migrations) await db.batch(migration.map(sql => db.prepare(sql)));
      const root = "http://127.0.0.1:" + env.FIXTURE_PORT;
      const direct = Array.from({ length: 6 }, (_, i) => ({
        name: "Direct " + (i + 1), url: root + (i === 5 && mode === "direct" ? "/late" : "/never") + "?job=" + (i + 1), adapter: "auto",
      }));
      const workdayNames = ["NVIDIA", "Broadcom", "Red Hat", "Zoom", "Visa", "Moderna"];
      const workday = workdayNames.map(name => ({ ...registry.find(source => source.name === name)!, adapter: "workday" }));
      const sources = mode === "workday" ? workday : mode === "local" || mode === "restart" ? profiles.slice(0, 6) : direct;
      const healthy = { name: "Healthy trailing source", url: root + "/ok", adapter: "auto" };
      await db.batch((mode === "run" ? [healthy, ...sources] : [...sources, healthy]).map(source =>
        db.prepare("INSERT INTO sources(name,url,adapter) VALUES (?,?,?)").bind(source.name, source.url, source.adapter)));
      if (mode === "run") {
        await db.prepare(`INSERT INTO job_candidates(source_id,canonical_url,dedupe_key,content_hash,payload_json,priority,
          first_seen_at,last_seen_at,expires_at,next_retry_at) VALUES (1,?,'fixture','fixture','{}',1,?,?,?,?)`)
          .bind(root + "/preserved", new Date().toISOString(), new Date().toISOString(),
            new Date(Date.now() + 3600_000).toISOString(), new Date(Date.now() + 600_000).toISOString()).run();
      }
      return Response.json({ ok: true });
    }
    if (route === "/state") {
      const { results: runs } = await db.prepare("SELECT * FROM scrape_runs ORDER BY id").all();
      const { results: sources } = await db.prepare(`SELECT source_id,name,stage,started_at,finished_at,error,metrics_json
        FROM scrape_source_progress WHERE source_id<>? ORDER BY source_id`).bind(SYNC_HEARTBEAT_SOURCE).all();
      const counts = await db.prepare(`SELECT (SELECT COUNT(*) FROM crawl_details) details, (SELECT COUNT(*) FROM jobs) jobs,
        (SELECT COUNT(*) FROM job_candidates) candidates, (SELECT COUNT(*) FROM job_candidates WHERE claim_run_id IS NOT NULL) claimed`).first();
      return Response.json({ runs, sources, counts });
    }
    if (route === "/progress") return progress();
    if (mode === "workday" && route === "/expire-workday" && request.method === "POST") {
      await db.prepare("UPDATE crawl_provider_cooldowns SET retry_at=0 WHERE provider='workday'").run();
      return Response.json({ ok: true });
    }
    if (mode === "workday" && route === "/verify-workday" && request.method === "POST") {
      return verifySource(request, { params: Promise.resolve({ id: "1" }) });
    }
    if (mode === "disconnect" && route === "/owner" && request.method === "POST") {
      const { age, status } = await request.json() as { age: number; status: "running" | "cancelling" };
      const stamp = new Date(Date.now() - age).toISOString();
      const run = await db.prepare("INSERT INTO scrape_runs(status,started_at,sources_total) VALUES (?,?,2)")
        .bind(status, stamp).run();
      const id = Number(run.meta.last_row_id);
      await db.batch([
        ...[[SYNC_HEARTBEAT_SOURCE, "success"], [1, "success"], [2, "fetching"]].map(([sourceId, stage]) =>
          db.prepare(`INSERT INTO scrape_source_progress(run_id,source_id,name,url,stage,updated_at)
            VALUES(?,?,'fixture','/',?,?)`).bind(id, sourceId, stage, stamp)),
        db.prepare(`INSERT INTO job_candidates(source_id,canonical_url,dedupe_key,content_hash,payload_json,
          first_seen_at,last_seen_at,expires_at,next_retry_at,claim_run_id) VALUES (1,?,?,'orphan','{}',?,?,?,?,?)`)
          .bind(`https://example.com/orphan/${id}`, `orphan-${id}`, stamp, stamp, new Date(Date.now() + 600_000).toISOString(), stamp, id),
      ]);
      return Response.json({ id });
    }
    if (route === "/stream-sync" && request.method === "POST") return streamSync(request);
    if (route === "/sync" && request.method === "POST") {
      return Response.json(await runSync({}, async (db, source, performance, options) => {
        const url = new URL(source.url);
        if (url.pathname === "/ok") return [];
        if (mode === "local" || mode === "restart" || mode === "workday") return crawlForSync(db, source, performance, options);
        performance.metrics.lastRequest = { address: url.host + url.pathname, startedAt: new Date().toISOString(), finishedAt: null };
        if (url.pathname !== "/late") {
          // The fixture deliberately ignores the per-source AbortSignal.
          await fetch(source.url);
          return [];
        }
        const abandoned = detailCache.run({ db, namespace: "late-source" }, () =>
          mapDetails([source.id], id => [id, "late"], async (): Promise<JobRecord> => {
            await (await fetch(source.url)).text();
            return { externalId: "late", title: "Late Junior Backend Engineer", canonicalUrl: source.url,
              company: "Fixture", location: "China", description: "Build Python APIs as a junior backend engineer." };
          }));
        context.waitUntil(abandoned.catch(() => {}));
        return abandoned;
      }));
    }
    return new Response(null, { status: 404 });
  },
};
