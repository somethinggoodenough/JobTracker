import { fork } from "node:child_process";
import { loadLocalTypeScript } from "./load-local-typescript.mjs";

const { withDeadline } = loadLocalTypeScript("lib/deadline.ts");

export async function superviseLocalCrawler({ key, filename, entry = new URL("./local-crawler.mjs", import.meta.url),
  healthIntervalMs = 5000, healthTimeoutMs = 3000, restartDelayMs = 1000, logger = console }) {
  let child, port = 0, stopping = false, restartTimer, checking = false, consecutiveFailures = 0;

  async function start() {
    const process = fork(entry, [], { windowsHide: true, execArgv: ["--max-old-space-size=1024"] });
    child = process;
    consecutiveFailures = 0;
    process.on("error", error => logger.error("Local crawler process:", error.message));
    process.once("exit", () => {
      if (child === process) child = undefined;
      if (!stopping && port) {
        restartTimer = setTimeout(() => { start().catch(error => logger.error(error.message)); }, restartDelayMs);
      }
    });
    try {
      port = await withDeadline("本地抓取进程启动", 10_000, undefined, () => new Promise((resolve, reject) => {
        process.once("message", message => {
          if (Number.isInteger(message?.port) && message.port > 0) resolve(message.port);
        });
        process.once("exit", () => reject(new Error("Local crawler exited during startup")));
        process.send({ port, key, filename }, error => { if (error) reject(error); });
      }));
    } catch (error) {
      process.kill("SIGKILL");
      throw error;
    }
  }

  await start();
  const timer = setInterval(async () => {
    const process = child;
    if (!process || checking || stopping) return;
    checking = true;
    try {
      await withDeadline("本地抓取进程健康检查", healthTimeoutMs, undefined, async signal => {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { signal, headers: { authorization: `Bearer ${key}` } });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          throw new Error(`HTTP ${response.status}`);
        }
        const health = await response.json();
        if (!Number.isFinite(health.heapUsedMb) || !Number.isFinite(health.eventLoopLagMs)) throw Error("Invalid health response");
      });
      if (child === process) consecutiveFailures = 0;
    } catch {
      if (!stopping && child === process && ++consecutiveFailures === 3) {
        logger.error(`Local crawler health check failed three times. Restarting process ${process.pid}.`);
        process.kill("SIGKILL");
      }
    } finally { checking = false; }
  }, healthIntervalMs).unref();

  return {
    port,
    close() {
      stopping = true;
      clearInterval(timer);
      clearTimeout(restartTimer);
      child?.kill();
    },
  };
}
