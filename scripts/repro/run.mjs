import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { probe } from "./probe.mjs";

const directory = fileURLToPath(new URL("./", import.meta.url));
const wrangler = fileURLToPath(new URL("../../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const fixture = createServer(() => {});
await new Promise((resolve, reject) => {
  fixture.once("error", reject);
  fixture.listen(0, "127.0.0.1", resolve);
});
const fixturePort = fixture.address().port;
const workerPort = Number(process.argv[2] || "48272");
const base = "http://127.0.0.1:" + workerPort;
const child = spawn(process.execPath, [wrangler, "dev", "--local", "--config", "wrangler.toml",
  "--port", String(workerPort), "--ip", "127.0.0.1", "--inspector-port", "0", "--var", "FIXTURE_PORT:" + fixturePort],
  { cwd: directory, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let logs = "";
for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { logs = (logs + chunk).slice(-6000); });

const cases = [["A", 5], ["A", 60], ["B", 5], ["B", 60], ["B", 200], ["C", 5], ["C", 200], ["D", 60], ["E", 200]];
function record(runtime, kind, seconds, result, wallMs) {
  const observed = result.elapsedMs ?? wallMs;
  console.log(JSON.stringify({ runtime, case: kind, expectedSeconds: seconds, wallMs,
    withinOneSecond: result.rejected && Math.abs(observed - seconds * 1000) <= 1000, ...result }));
}

try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch(base + "/health", { signal: AbortSignal.timeout(300) })).ok; } catch {}
    if (ready || child.exitCode !== null) break;
    await sleep(200);
  }
  if (!ready) throw Error("Reproduction Worker did not start.\n" + logs);
  console.log(JSON.stringify({ node: process.version, cases: cases.length, longestSeconds: 200 }));
  const upstream = "http://127.0.0.1:" + fixturePort;
  await Promise.all(cases.flatMap(([kind, seconds]) => {
    const ms = seconds * 1000;
    return ["workerd", "node"].map(async runtime => {
      const start = Date.now();
      let timer;
      try {
        const run = runtime === "workerd"
          ? fetch(base + "/?case=" + kind + "&ms=" + ms, { signal: AbortSignal.timeout(ms + 3500) }).then(r => r.json())
          : probe(kind, ms, upstream);
        const result = await Promise.race([run, new Promise(resolve => {
          timer = setTimeout(() => resolve({ rejected: false, error: "no rejection before observer deadline" }), ms + 3500);
        })]);
        record(runtime, kind, seconds, result, Date.now() - start);
      } catch (error) {
        record(runtime, kind, seconds, { rejected: false, error: "observer: " + error.name }, Date.now() - start);
      } finally { clearTimeout(timer); }
    });
  }));
} finally {
  fixture.closeAllConnections();
  await new Promise(resolve => fixture.close(resolve));
  child.kill();
}
