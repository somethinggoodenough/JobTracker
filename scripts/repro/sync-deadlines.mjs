import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { superviseLocalCrawler } from "../local-crawler-supervisor.mjs";
import { createLocalCrawler } from "../local-crawler.mjs";
import { loadLocalTypeScript } from "../load-local-typescript.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cwd = fileURLToPath(new URL("./", import.meta.url));
const basePort = Number(process.env.DEADLINE_TEST_PORT || 48280);
const fast = process.argv.includes("--fast");
const availableModes = ["direct", "local", "run", "restart", "disconnect", "workday"];
const peers = process.argv.filter(arg => availableModes.includes(arg));
const modes = peers.length ? peers : availableModes;
const sourceSeconds = fast ? 8 : 180;
const runSeconds = fast ? 4 : 60;
const key = "deadline-fixture-only";
const migrations = readdirSync(resolve(root, "drizzle")).filter(name => name.endsWith(".sql")).sort().map(name =>
  readFileSync(resolve(root, "drizzle", name), "utf8").split("--> statement-breakpoint").map(sql => sql.trim()).filter(Boolean));
mkdirSync(resolve(root, "outputs"), { recursive: true });
const state = mkdtempSync(resolve(root, "outputs/deadline-acceptance-"));

async function listen(server) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return server.address().port;
}

const fixtures = [];
let lateReplies = 0;
const upstream = createServer((req, res) => {
  if (req.url.startsWith("/late")) {
    const timer = setTimeout(() => {
      lateReplies++;
      res.end("late body");
    }, sourceSeconds * 1000 + 700);
    res.on("close", () => clearTimeout(timer));
  }
});
const upstreamPort = await listen(upstream);
fixtures.push(upstream);
let local;
async function run(mode, index) {
  const port = basePort + index;
  let sidecarPort;
  let killedAt = 0;
  let workdayResponse = "120";
  const workdayCalls = [];
  if (mode === "local") {
    const sidecar = createServer((req, res) => {
      if (req.headers.authorization !== "Bearer " + key) { res.writeHead(404).end(); return; }
      if (req.url.startsWith("/health")) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ active: 6, heapUsedMb: 30, heapLimitMb: 1000, eventLoopLagMs: 25, heapPeakMb: 34 }));
      } else if (req.url.startsWith("/status")) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ lastRequest: { address: "upstream.example/jobs", startedAt: new Date().toISOString(), finishedAt: null },
          activeRequests: 1, maxResponseBytes: 321 }));
      }
    });
    sidecarPort = await listen(sidecar);
    fixtures.push(sidecar);
  } else if (mode === "workday") {
    const { workdayRateLimit, WorkdayRateLimitError } = loadLocalTypeScript("lib/workday-rate-limit.ts");
    const sidecar = createLocalCrawler({ key, filename: resolve(state, "workday-details.sqlite"), execute: async (_db, source, { metrics }) => {
      workdayCalls.push({ name: source.name, started: Date.now() });
      if (source.name === "NVIDIA" && workdayResponse !== "ok") {
        await sleep(900);
        const cooldown = workdayRateLimit(new URL(source.url), workdayResponse);
        metrics.listRequests++;
        metrics.throttled++;
        metrics.workdayCooldown = cooldown;
        throw new WorkdayRateLimitError(cooldown);
      }
      return [];
    } });
    sidecarPort = await listen(sidecar);
    fixtures.push(sidecar);
  } else if (mode === "restart") {
    local = await superviseLocalCrawler({ key, filename: resolve(state, "fixture-details.sqlite"), entry: new URL("./blocking-crawler.mjs", import.meta.url),
      logger: { error: (...args) => { if (String(args[0]).includes("Restarting process")) killedAt = Date.now(); console.error(...args); } } });
    sidecarPort = local.port;
  }
  const vars = {
    FIXTURE_PORT: upstreamPort, FIXTURE_MODE: mode,
    JOB_RADAR_SOURCE_TIMEOUT_SECONDS: mode === "restart" ? 45 : mode === "disconnect" ? 8 : sourceSeconds,
    JOB_RADAR_RUN_TIMEOUT_SECONDS: mode === "run" ? runSeconds : Math.max(90, sourceSeconds + 30),
    JOB_RADAR_CRAWLER_PORT: sidecarPort ?? 0, JOB_RADAR_CRAWLER_KEY: key,
  };
  const args = [resolve(root, "node_modules/wrangler/bin/wrangler.js"), "dev", "--local",
    "--config", "sync.toml", "--persist-to", resolve(state, mode), "--ip", "127.0.0.1",
    "--port", String(port), "--inspector-port", "0", ...Object.entries(vars).flatMap(([name, value]) => ["--var", name + ":" + value])];
  const child = spawn(process.execPath, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { logs = (logs + chunk).slice(-6000); });
  const base = "http://127.0.0.1:" + port;
  async function request(path, init = {}, ms = 30_000) {
    const response = await fetch(base + path, { ...init, signal: AbortSignal.timeout(ms) });
    if (!response.ok) throw Error("HTTP " + response.status + " " + await response.text());
    return await response.json();
  }
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { ready = (await fetch(base + "/health", { signal: AbortSignal.timeout(2000) })).ok; } catch {}
      if (ready || child.exitCode !== null) break;
      await sleep(250);
    }
    if (!ready) throw Error("Fixture Worker startup failed.\n" + logs);
    await request("/setup", { method: "POST", body: JSON.stringify(migrations) });

    if (mode === "workday") {
      const sync = async () => {
        await request("/sync", { method: "POST" });
        return (await request("/progress")).sources.slice(1);
      };
      const first = await sync();
      const firstCooldown = JSON.parse(first[0].metrics_json).workdayCooldown;
      assert.equal(firstCooldown.retryAfter, "120");
      assert(firstCooldown.retryAt > Date.now(), "Retry-After must survive the sidecar transport");
      assert(first.slice(0, 6).every(row => row.stage === "rate_limited" && row.finished_at));
      assert.equal(first.at(-1).stage, "success");
      assert(Date.parse(first.at(-1).finished_at) < Date.parse(first[0].finished_at), "Other sources must not wait for the 429");
      assert.deepEqual(workdayCalls.map(call => call.name), ["NVIDIA"]);
      assert(first.slice(1, 6).every(row => !row.started_at));

      const verify = await fetch(base + "/verify-workday", { method: "POST" });
      assert.equal(verify.status, 429);
      assert.equal((await verify.json()).cooldown.retryAt, firstCooldown.retryAt);
      assert((await sync()).slice(0, 6).every(row => row.stage === "rate_limited" && !row.started_at));
      assert.equal(workdayCalls.length, 1, "Next sync must respect the saved cooldown");

      await request("/expire-workday", { method: "POST" });
      workdayResponse = null;
      const missing = await sync();
      assert.equal(JSON.parse(missing[0].metrics_json).workdayCooldown.retryAt, null);
      assert.equal(workdayCalls.length, 2);
      workdayResponse = "ok";
      const resumed = await sync();
      assert(resumed.every(row => row.stage === "success"));
      assert.equal(workdayCalls.length, 8);
      const starts = workdayCalls.slice(2).map(call => call.started);
      assert(starts.slice(1).every((start, i) => start - starts[i] >= 725));
      console.log(JSON.stringify({ mode, workdayCalls: workdayCalls.length, pass: true }));
      return;
    }

    if (mode === "disconnect") {
      const controller = new AbortController();
      const response = await fetch(base + "/stream-sync", { method: "POST", signal: controller.signal });
      assert.equal(response.status, 200);
      assert.equal(new TextDecoder().decode((await response.body.getReader().read()).value), "\n");
      let active = false;
      for (let i = 0; i < 50; i++) {
        if ((await request("/state")).sources.some(row => row.stage === "fetching")) { active = true; break; }
        await sleep(100);
      }
      assert(active, "Owner must disconnect with active source requests");
      const disconnectedAt = Date.now();
      controller.abort();
      const observationDeadline = Date.now() + 25_000;
      let disconnectedRun;
      while (Date.now() < observationDeadline) {
        const snapshot = await request("/state");
        const terminal = snapshot.runs[0];
        if (terminal?.finished_at && snapshot.sources.every(row => !["queued", "fetching", "saving", "classifying"].includes(row.stage))) {
          // Wrangler's dev proxy sometimes holds the upstream connection open.
          assert.match(terminal.error_summary, /同步连接已断开|单个来源抓取超过/);
          assert.equal(snapshot.counts.claimed, 0);
          disconnectedRun = terminal;
          break;
        }
        await sleep(100);
      }
      assert(disconnectedRun, "Owner disconnected without finalizing its run within 25 seconds.");
      console.log(JSON.stringify({ mode, elapsed: Date.now() - disconnectedAt, status: disconnectedRun.status, pass: true }));

      const seedOwner = (age, status) => request("/owner", { method: "POST", body: JSON.stringify({ age, status }) });
      for (const [age, expected, initial] of [[44_000, "running", "running"], [46_000, "partial", "running"], [46_000, "cancelled", "cancelling"]]) {
        const { id } = await seedOwner(age, initial);
        const view = await request("/progress");
        assert.equal(view.run.id, id);
        assert.equal(view.run.status, expected);
        assert.equal(view.sources.length, 2, "internal heartbeat is hidden from progress");
        assert.equal(view.sources[1].stage, expected === "running" ? "fetching" : expected === "partial" ? "failed" : "cancelled");
        const stored = await request("/state");
        assert.equal(stored.counts.claimed, 1, "the fresh owner keeps its claim and the abandoned owner releases its claim");
        if (expected !== "running") {
          assert.match(view.run.error_summary, /同步进程心跳中断/);
          assert.deepEqual((await request("/progress")).run, view.run, "orphan cleanup is idempotent");
        }
      }
      console.log(JSON.stringify({ mode: "orphan", pass: true }));
      return;
    }

    const started = Date.now();
    const summary = await request("/sync", { method: "POST" }, (vars.JOB_RADAR_RUN_TIMEOUT_SECONDS + 6) * 1000);
    const elapsed = Date.now() - started;
    const snapshot = await request("/state");
    const sources = snapshot.sources.filter(row => row.source_id > 0);
    assert(sources.every(row => ["success", "failed", "partial", "cancelled"].includes(row.stage)));
    if (mode === "run") {
      assert(["partial", "failed"].includes(summary.status));
      assert(Math.abs(elapsed - runSeconds * 1000) <= 2000, "whole-run deadline: " + elapsed);
      assert.equal(snapshot.counts.candidates, 1);
      assert.equal(snapshot.counts.claimed, 0);
    } else if (mode === "restart") {
      const blockedAt = Date.parse(readFileSync(resolve(state, "fixture-details.sqlite.blocked"), "utf8"));
      assert(killedAt >= blockedAt && killedAt - blockedAt <= 20_000, "watchdog recovery exceeded 20 seconds");
      assert(sources.every(row => row.stage === "success"), JSON.stringify(sources));
      assert.equal(summary.status, "success");
      assert(Date.parse(sources[0].started_at) >= Date.parse(sources.at(-1).started_at), "interrupted source requeued at tail");
    } else {
      assert.equal(summary.status, "partial");
      assert.equal(sources.at(-1).stage, "success");
      for (const row of sources.slice(0, 6)) {
        const time = Date.parse(row.finished_at) - Date.parse(row.started_at);
        assert(Math.abs(time - sourceSeconds * 1000) <= 2000, "source deadline: " + time);
        assert.equal(row.stage, "failed");
        assert.match(row.error, /最后请求：/);
        const metrics = JSON.parse(row.metrics_json);
        assert.equal(metrics.deadlineHit, true);
        assert.equal(metrics.lastRequest.address.includes("?"), false);
        if (mode === "local") {
          assert.equal(metrics.lastRequest.address, "upstream.example/jobs");
          assert.equal(metrics.maxResponseBytes, 321);
          assert.equal(metrics.localHealth.heapPeakMb, 34);
        }
      }
      assert.equal(snapshot.counts.details, 0);
      assert.equal(snapshot.counts.jobs, 0);
      assert.equal(snapshot.counts.candidates, 0);
      await sleep(1800);
      assert.deepEqual(await request("/state"), snapshot, "late responses must not change any data or progress");
      if (mode === "direct") assert.equal(lateReplies, 1, "fixture must actually deliver the late response");
    }
    console.log(JSON.stringify({ mode, elapsed, status: summary.status, conflicts: snapshot.counts, pass: true }));
  } catch (error) {
    throw new Error(mode + ": " + error.message + "\n" + logs, { cause: error });
  } finally { child.kill(); }
}

try {
  const results = await Promise.allSettled(modes.map(run));
  for (const result of results) if (result.status === "rejected") { process.exitCode = 1; console.error(result.reason); }
} finally {
  local?.close();
  for (const server of fixtures) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
