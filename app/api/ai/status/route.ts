import { getD1 } from "@/lib/database";
import { deepseekConfig } from "@/lib/deepseek-config";
import { AI_POLICY } from "@/lib/classification-types";
import { dailyModelBudget } from "@/lib/ai-budget";
export const dynamic = "force-dynamic";
export async function GET() {
  const db = getD1(), config = deepseekConfig();
  const monthStart = new Date().toISOString().slice(0, 7)+"-01T00:00:00.000Z";
  const usage = await db.prepare(`SELECT model,COUNT(*) AS calls,SUM(prompt_tokens) AS prompt_tokens,
    SUM(completion_tokens) AS completion_tokens,SUM(cached_tokens) AS cached_tokens FROM ai_usage WHERE created_at>=?1 GROUP BY model`).bind(monthStart).all();
  const pending = await db.prepare("SELECT COUNT(*) AS total FROM jobs WHERE ai_policy IS NULL OR ai_policy<>?1").bind(AI_POLICY).first<{ total: number }>();
  const candidates = await db.prepare("SELECT COUNT(*) AS total FROM job_candidates WHERE expires_at>?1").bind(new Date().toISOString()).first<{ total: number }>();
  const dailyBudget = await dailyModelBudget(db);
  const latestScreening = await db.prepare(`SELECT id,status,finished_at,ai_rule_rejected,ai_cache_hits,ai_requests
    FROM scrape_runs WHERE ai_rule_rejected IS NOT NULL ORDER BY id DESC LIMIT 1`).first();
  return Response.json({ configured: !!config.apiKey, model: config.model, policy: AI_POLICY, pendingReview: pending?.total ?? 0, pendingCandidates: candidates?.total ?? 0, dailyBudget, latestScreening, monthStart, usage: usage.results }, { headers: { "Cache-Control": "no-store" } });
}
