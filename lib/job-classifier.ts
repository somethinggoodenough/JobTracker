import type { JobRecord } from "./job-types";
import { AI_POLICY, CLASSIFIER_VERSION, careerLevels, jobCategories, type JobAnalysis, type JobDecision } from "./classification-types";
import { currentSyncSignal, syncDelay, throwIfSyncCancelled } from "./sync-control";
import { localShortlist, SHORTLIST_VERSION } from "./local-shortlist";
import { reserveModelRequest } from "./ai-budget";
import { confirmedUsSponsorship } from "./sponsorship";
import { AI_RESPONSE_CONTRACT, type CoarseFilter, type ScreeningRules } from "./screening-defaults";
import { currentScreeningRules, screeningIdentity } from "./screening-context";

const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
export function ruleRejection(job: JobRecord, coarse: CoarseFilter = currentScreeningRules().coarse): string | null {
  const text = normalize(`${job.title}\n${job.description}`);
  if (coarse.excludedKeywords.some(word => text.includes(normalize(word)))) return "本地预筛：包含已排除的关键词";
  if (coarse.requiredKeywords.length && !coarse.requiredKeywords.some(word => text.includes(normalize(word)))) return "本地预筛：未包含任一必需关键词";
  if (coarse.rejectSeniorTitles && /\b(senior|sr\.?|staff|principal|lead|manager|director|head|vp|vice president|distinguished)\b|高级|高級|资深|資深|总监|總監|负责人|負責人|专家|專家|经理|經理/i.test(job.title)) return "职位明确要求资深或管理级别";
  const location = job.location || "";
  const allowed = /\b(USA|US|United States|China|PRC)\b|美国|美國|中国|中國/i.test(location);
  if (coarse.rejectForeignLocations && !allowed && /\b(Canada|United Kingdom|UK|Germany|India|Singapore|Australia|France|Japan|Korea|Netherlands|Ireland|Switzerland|Israel|Poland|Spain|Brazil|Mexico)\b|加拿大|英国|德国|印度|新加坡|澳大利亚|法国|日本|韩国|荷兰|爱尔兰|瑞士|以色列/i.test(location)) return "工作地点明确不在中国或美国";
  if (!job.description?.trim()) return "JD 缺失，无法确认岗位、级别和技术要求";
  return null;
}

// The editable preference prompt and fixed response contract are defined separately.

function evidence(text: unknown, haystack: string): text is string {
  return typeof text === "string" && text.trim().length >= 2 && text.length <= 350 && normalize(haystack).includes(normalize(text));
}
export function parseDecision(value: unknown, job: JobRecord, coarse: CoarseFilter = currentScreeningRules().coarse): JobDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AI 返回了无效的筛选结果");
  const data = value as Record<string, any>;
  if (typeof data.accepted !== "boolean" || typeof data.reason !== "string" || !data.reason.trim() || data.reason.length > 500) throw new Error("AI 筛选结果字段无效");
  if (!data.accepted) return { accepted: false, reason: data.reason.slice(0, 200) };
  if (!Array.isArray(data.categories) || !data.categories.length || data.categories.length > Object.keys(jobCategories).length || data.categories.some((v: unknown) => typeof v !== "string" || !Object.hasOwn(jobCategories, v)) || !Object.hasOwn(careerLevels, data.careerLevel)) throw new Error("AI 岗位分类或级别无效");
  if (!Array.isArray(data.countries) || !data.countries.length || data.countries.length > 2 || data.countries.some((v: unknown) => v !== "CN" && v !== "US")) throw new Error("AI 工作地点不符合中美限制");
  if (!evidence(data.roleEvidence, `${job.title}\n${job.description}`) || !evidence(data.levelEvidence, `${job.title}\n${job.description}`) || !evidence(data.locationEvidence, `${job.location}\n${job.description}`)) throw new Error("AI 判断缺少可核实的原文依据");
  if (!Array.isArray(data.techStack) || data.techStack.length > 20 || data.techStack.some((tech: any) => !tech || typeof tech.name !== "string" || !tech.name.trim() || tech.name.length > 80 || !evidence(tech.evidence, job.description))) throw new Error("AI 技术栈缺少 JD 原文依据");
  const rejected = ruleRejection(job, coarse); if (rejected) return { accepted: false, reason: rejected };
  const sponsorship = confirmedUsSponsorship(job.description, data.countries, data.usSponsorship, job.location);
  return { accepted: true, categories: [...new Set(data.categories)] as JobAnalysis["categories"], careerLevel: data.careerLevel,
    countries: [...new Set(data.countries)] as JobAnalysis["countries"], techStack: data.techStack.map((t: any) => ({ name: t.name.trim(), evidence: t.evidence.trim() })),
    roleEvidence: data.roleEvidence, levelEvidence: data.levelEvidence, locationEvidence: data.locationEvidence, reason: data.reason.slice(0, 200),
    ...(sponsorship ? { usSponsorship: sponsorship } : {}) };
}

export async function classificationKey(job: JobRecord, model: string, revision: string | null = CLASSIFIER_VERSION, rules: ScreeningRules = currentScreeningRules()) {
  const identity = screeningIdentity(rules);
  const content = JSON.stringify([...(revision ? [revision, SHORTLIST_VERSION] : []), ...(identity ? [identity] : []), AI_POLICY, model, job.company, job.title, job.location, job.workplaceType || "", job.employmentType || "", job.department || "", job.description]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export class ClassificationUnavailable extends Error {}
export class AwaitingClassification extends Error {
  constructor(public priority: number) { super("候选待模型审核"); }
}
class InvalidClassificationOutput extends ClassificationUnavailable {}
export function createJobClassifier(db: D1Database, config: { apiKey: string; model: string; screening?: ScreeningRules }) {
  const settings = config.screening ?? currentScreeningRules();
  // Request-local promises: never share Worker I/O or AbortControllers between requests.
  const pending = new Map<string, Promise<JobDecision>>();
  let active = 0, fatal = "";
  const queue: (() => void)[] = [];
  const metrics = { calls: 0, requests: 0, cacheHits: 0, ruleRejected: 0 };
  async function remote(job: JobRecord, key: string, feedback?: string): Promise<JobDecision> {
    if (active >= 4) await new Promise<void>(resolve => queue.push(resolve));
    else active++;
    try {
      throwIfSyncCancelled();
      if (fatal) throw new ClassificationUnavailable(fatal);
      if (!config.apiKey) throw new ClassificationUnavailable("未读取到 DeepSeek API Key，请检查 .env 后重启本地服务");
      let response: Response | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        throwIfSyncCancelled();
        // Reserve every outbound attempt, including retries and corrective requests.
        await reserveModelRequest(db);
        throwIfSyncCancelled();
        try {
          metrics.requests++;
          response = await fetch("https://api.deepseek.com/chat/completions", {
            method: "POST", headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
            signal: AbortSignal.any([AbortSignal.timeout(60_000), currentSyncSignal()].filter((s): s is AbortSignal => !!s)),
            body: JSON.stringify({ model: config.model, thinking: { type: "disabled" }, temperature: 0, max_tokens: feedback ? 2200 : 1600,
              response_format: { type: "json_object" }, messages: [{ role: "system", content: settings.aiPrompt + "\n\n" + AI_RESPONSE_CONTRACT },
                { role: "user", content: JSON.stringify({ title: job.title, company: job.company, location: job.location,
                  employmentType: job.employmentType, workplaceType: job.workplaceType, department: job.department, jd: job.description }) },
                ...(feedback ? [{ role: "user", content: `Your previous response failed validation: ${feedback}. Correct the JSON schema and exact verbatim evidence using ONLY the job data above. Use only the allowed category, level and country codes. If eligibility cannot be proved, return accepted:false with a reason. Keep quotes short and exact. Return JSON only.` }] : [])] }),
          });
        } catch {
          throwIfSyncCancelled();
          throw new ClassificationUnavailable("DeepSeek 请求超时或网络异常，本条未入库，下次同步重试");
        }
        if ((response.status === 429 || response.status >= 500) && attempt === 0) { await response.body?.cancel(); await syncDelay(1500); continue; }
        break;
      }
      if (!response?.ok) {
        await response?.body?.cancel();
        const code = response?.status || 0;
        if ([401,402,403,404].includes(code)) fatal = `DeepSeek HTTP ${code}：请检查密钥、余额或模型配置；未筛选职位不会入库`;
        throw new ClassificationUnavailable(fatal || `DeepSeek HTTP ${code}，本条未入库，下次同步重试`);
      }
      metrics.calls++;
      const data = await response.json() as { choices?: { finish_reason?: string; message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number } };
      const usage = data.usage || {};
      // Record only token counts/model. Never persist credentials, prompts or job payloads here.
      const count = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : 0;
      await db.prepare("INSERT INTO ai_usage (id,model,prompt_tokens,completion_tokens,cached_tokens,created_at) VALUES (?1,?2,?3,?4,?5,?6)")
        .bind(crypto.randomUUID(), config.model, count(usage.prompt_tokens), count(usage.completion_tokens), count(usage.prompt_cache_hit_tokens), new Date().toISOString()).run();
      let decision: JobDecision;
      try {
        if (data.choices?.[0]?.finish_reason !== "stop") throw new Error("Incomplete JSON");
        decision = parseDecision(JSON.parse(data.choices[0].message?.content || ""), job, settings.coarse);
      } catch (error) {
        const detail = error instanceof Error && error.message.startsWith("AI ") ? error.message : "JSON 不完整或格式无效";
        throw new InvalidClassificationOutput(`DeepSeek ${detail}，本条未入库，下次同步重试`);
      }
      throwIfSyncCancelled();
      const now = new Date().toISOString();
      await db.prepare("INSERT OR REPLACE INTO job_evaluations (cache_key,decision_json,model,created_at,expires_at) VALUES (?1,?2,?3,?4,?5)")
        .bind(key, JSON.stringify(decision), config.model, now, new Date(Date.now()+30*86400000).toISOString()).run();
      return decision;
    } finally { const next = queue.shift(); if (next) next(); else active--; }
  }
  return {
    settings,
    metrics,
    async evaluate(job: JobRecord, options: { cacheOnly?: boolean } = {}): Promise<JobDecision> {
      throwIfSyncCancelled();
      const reason = ruleRejection(job, settings.coarse);
      if (reason) { metrics.ruleRejected++; return { accepted: false, reason }; }
      const key = await classificationKey(job, config.model, CLASSIFIER_VERSION, settings);
      if (pending.has(key)) { metrics.cacheHits++; return pending.get(key)!; }
      const promise = (async () => {
        const row = await db.prepare("SELECT decision_json FROM job_evaluations WHERE cache_key=?1 AND expires_at>?2").bind(key, new Date().toISOString()).first<{ decision_json: string }>();
        if (row) { try { const decision = parseDecision(JSON.parse(row.decision_json), job, settings.coarse); metrics.cacheHits++; return decision; } catch { /* Reclassify corrupt/obsolete cache. */ } }
        // The old role policy was narrower. Its approvals remain valid; old
        // rejections must be reconsidered under the expanded role categories.
        const oldKey = await classificationKey(job, config.model, null, settings);
        const legacy = await db.prepare("SELECT decision_json FROM job_evaluations WHERE cache_key=?1 AND expires_at>?2").bind(oldKey, new Date().toISOString()).first<{ decision_json: string }>();
        if (legacy) {
          try { const old = JSON.parse(legacy.decision_json); if (old.accepted === true) { const decision = parseDecision(old, job, settings.coarse); metrics.cacheHits++; return decision; } } catch { /* Ignore invalid legacy entries. */ }
        }
        const shortlist = localShortlist(job, settings.coarse);
        if (shortlist.reason) { metrics.ruleRejected++; return { accepted: false as const, reason: shortlist.reason }; }
        if (options.cacheOnly) throw new AwaitingClassification(shortlist.priority);
        try { return await remote(job, key); }
        catch (error) {
          // One corrective retry, after remote() has released its concurrency slot.
          // An API/auth/network error never becomes an eligibility rejection.
          if (error instanceof InvalidClassificationOutput) return remote(job, key, error.message);
          throw error;
        }
      })();
      pending.set(key, promise);
      // Only deduplicate in-flight calls. Keeping settled promises can retain full
      // JD/fetch contexts through async stacks during a large historical review.
      try { return await promise; } finally { pending.delete(key); }
    },
  };
}
