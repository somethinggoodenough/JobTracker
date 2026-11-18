const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = portIndex >= 0 && args[portIndex + 1] ? args[portIndex + 1] : "4173";
const intervalMinutes = Number(process.env.JOB_RADAR_INTERVAL_MINUTES || 60);
const syncUrl = `http://127.0.0.1:${port}/api/sync`;

async function sync() {
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch(syncUrl, { method: "POST", signal: AbortSignal.timeout(55 * 60_000) });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || `HTTP ${response.status}`);
    console.log(`[${startedAt}] hourly sync complete`, JSON.stringify(payload));
  } catch (error) {
    console.error(`[${startedAt}] hourly sync failed:`, error instanceof Error ? error.message : error);
  }
}

console.log(`Job Radar scheduler active: ${syncUrl}, every ${intervalMinutes} minutes`);
setInterval(sync, intervalMinutes * 60_000);
