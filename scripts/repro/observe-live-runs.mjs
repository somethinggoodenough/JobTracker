import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

const base = process.argv[2] || "http://127.0.0.1:4173";
const rounds = Number(process.argv[3] || 5);
const between = Number(process.argv[4] || 30_000);
const attachRun = Number(process.argv[5] || 0);
const isOpen = status => status === "running" || status === "cancelling";
const activeStages = new Set(["queued", "fetching", "saving", "classifying"]);
if (!Number.isSafeInteger(rounds) || rounds < 1 || !Number.isSafeInteger(between) || between < 0
    || !Number.isSafeInteger(attachRun) || attachRun < 0) throw Error("Invalid round count, interval, or run ID");

async function progress(until = Date.now() + 180_000) {
  let last;
  let retryAt = 0;
  while (Date.now() < until) {
    try {
      const response = await fetch(base + "/api/sync/progress", { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw Error("Progress HTTP " + response.status);
      return await response.json();
    } catch (error) {
      last = error;
      if (Date.now() >= retryAt) {
        console.warn(`Waiting for the progress endpoint (${error.message})`);
        retryAt = Date.now() + 60_000;
      }
      await sleep(2500);
    }
  }
  throw last;
}

for (let n = 1; n <= rounds; n++) {
  const previous = await progress();
  const attaching = n === 1 && attachRun > 0;
  if (attaching) assert.equal(previous.run?.id, attachRun, "The specified run is not the most recent one");
  else if (isOpen(previous.run?.status)) throw Error("A sync is already active. Wait for it to finish.");
  const earlierRun = previous.run?.id ?? 0;
  let responseError, responseRun;
  const sync = attaching ? Promise.resolve() : fetch(base + "/api/sync", { method: "POST", signal: AbortSignal.timeout(65 * 60_000) })
    .then(async response => {
      const payload = await response.json();
      if (!response.ok || payload.error) throw Error(payload.error ?? "Sync HTTP " + response.status);
      responseRun = payload.runId;
    }).catch(error => { responseError = error; });
  let activeRunId = attaching ? attachRun : null, maximumFetchingMs = 0, lastReported = 0;
  let final;
  const until = Date.now() + 65 * 60_000;
  while (Date.now() < until) {
    const snap = await progress(until);
    if (!snap.run || (!activeRunId && snap.run.id <= earlierRun)) {
      if (responseError) throw responseError;
      await sleep(2500);
      continue;
    }
    if (activeRunId && activeRunId !== snap.run.id) throw Error("Another sync started during verification.");
    activeRunId = snap.run.id;
    const wall = Date.parse(snap.checkedAt);
    for (const row of snap.sources) {
      if (row.stage !== "fetching" || !row.started_at) continue;
      maximumFetchingMs = Math.max(maximumFetchingMs, wall - Date.parse(row.started_at));
      assert(wall - Date.parse(row.started_at) <= 190_000, "Source stuck fetching: " + row.name);
    }
    if (wall - lastReported >= 30_000) {
      lastReported = wall;
      console.log(JSON.stringify({ round: n, run: activeRunId, status: snap.run.status,
        sourcesFinished: snap.sources.filter(row => !activeStages.has(row.stage)).length, sourcesTotal: snap.sources.length }));
    }
    if (!isOpen(snap.run.status) && snap.sources.every(row => !activeStages.has(row.stage))) { final = snap; break; }
    await sleep(2500);
  }
  assert(final, "No final state within the observation period.");
  await sync;
  if (responseRun) assert.equal(final.run.id, responseRun);
  assert(final.run.status === "success" || final.run.status === "partial", "Sync did not complete: " + final.run.status);
  assert(!final.run.error_summary?.includes("同步进程心跳中断"), "Orphan recovery does not count as a completed verification run");
  const metrics = final.sources.flatMap(row => { try { return row.metrics_json ? [JSON.parse(row.metrics_json)] : []; } catch { return []; } });
  const peak = Math.max(0, ...metrics.map(value => value.localHeapPeakMb || 0));
  assert(peak > 0, "No sampled local heap peak was recorded");
  const crawlMs = Math.max(maximumFetchingMs, 0, ...metrics.map(value => value.crawlMs || 0));
  assert(crawlMs <= 190_000, "A crawl took more than 190 seconds before returning");
  console.log(JSON.stringify({ round: n, run: final.run.id, status: final.run.status,
    elapsedSeconds: Math.round((Date.parse(final.run.finished_at) - Date.parse(final.run.started_at)) / 1000),
    maxFetchingSeconds: Math.round(crawlMs / 1000), heapPeakMb: Number(peak.toFixed(1)),
    sourcesSucceeded: final.run.sources_succeeded, sourcesTotal: final.run.sources_total, passed: true }));
  if (n < rounds && between) await sleep(between);
}
