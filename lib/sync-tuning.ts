import { env } from "cloudflare:workers";

const bindings = env as unknown as Record<string, unknown>;
function readInt(key: string, fallback: number, max: number) {
  const value = Number(bindings[key]);
  return Number.isInteger(value) && value > 0 && value <= max ? value : fallback;
}
export const syncTuning = () => ({
  sources: readInt("JOB_RADAR_SOURCE_CONCURRENCY", 6, 12),
  requests: readInt("JOB_RADAR_HTTP_CONCURRENCY", 12, 24),
  ai: readInt("JOB_RADAR_AI_CONCURRENCY", 3, 4),
  sourceTimeoutMs: readInt("JOB_RADAR_SOURCE_TIMEOUT_SECONDS", 180, 600) * 1000,
});
