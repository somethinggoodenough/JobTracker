"use client";
import { useEffect, useRef, useState } from "react";
import { estimateAiCost } from "@/lib/ai-cost";
import AiBudgetSettings, { type DailyBudget } from "./ai-budget-settings";
type Usage = { model: string; calls: number; prompt_tokens: number; completion_tokens: number; cached_tokens: number };
type Status = { configured: boolean; model: string; pendingReview: number; pendingCandidates: number; usage: Usage[];
  dailyBudget: DailyBudget; latestScreening: { id: number; ai_rule_rejected: number; ai_cache_hits: number; ai_requests: number } | null };
export default function AiFilterPanel({ active, onReview }: { active: boolean; onReview: () => void }) {
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState("");
  const statusVersion = useRef(0);
  useEffect(() => {
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    async function load() { const version = statusVersion.current; try {
      const response = await fetch("/api/ai/status", { cache: "no-store" });
      if (!response.ok) throw new Error("无法读取 AI 筛选状态");
      const data = await response.json() as Status; if (!cancelled && version === statusVersion.current) { setStatus(data); setError(""); }
    } catch { if (!cancelled) setError("暂时无法读取 AI 筛选状态，请稍后刷新"); }
    if (!cancelled) timer = setTimeout(load, active ? 3000 : 30000); }
    load(); return () => { cancelled = true; clearTimeout(timer); };
  }, [active]);
  const cost = status ? estimateAiCost(status.usage) : null;
  const exhausted = status?.dailyBudget.remaining === 0, paused = status?.dailyBudget.limit === 0;
  return <section className="mb-6 rounded-2xl border border-[#cbd9c0] bg-[#eff5e7] p-5" aria-label="AI 筛选状态">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold text-[#305336]">相关技术岗位，宽松纳入</h2><p className="mt-2 text-xs leading-6 text-[#64725d]">软件 / AI / 数据科学 / 量化 / 技术方案 / 客户部署及相邻技术岗位，有相关职责即可考虑。<br />Internship / New Grad / Junior · 工作地点中国或美国；先粗筛、去重和复用缓存，再交给 DeepSeek。<br />美国岗位明确提供签证赞助时标注 US Sponsorship，并保留 JD 原句。<br />有发布日期只抓纽约当天发布的岗位；无发布日期时每个来源最多取前 50 条。</p></div>
      {!!status && (status.pendingReview>0 || status.pendingCandidates>0) && <button disabled={active || !status.configured || exhausted} onClick={onReview} className="sync-button">{active ? "筛选进行中…" : paused ? "AI 筛选已暂停" : exhausted ? "今日额度已用完" : "审核排队职位"}</button>}
    </div>
    {status && <AiBudgetSettings budget={status.dailyBudget} onSaveStart={()=>{statusVersion.current++;}} onSaved={dailyBudget=>{statusVersion.current++;setStatus(previous=>previous?{...previous,dailyBudget}:previous);}} />}
    {status && <p className={`mt-3 text-xs leading-6 ${status.configured ? "text-[#64725d]" : "text-red-700"}`}>{status.configured ? `模型：${status.model} · 本月实际模型请求 ${status.usage.reduce((n, r) => n+r.calls, 0)} 次${cost ? ` · 本月估算 $${cost.low.toFixed(2)}–$${cost.high.toFixed(2)}` : ""}（按官方高低峰价格估算，以账单为准）` : "未读取到 DeepSeek 密钥，暂时不能收录新职位。请检查 .env 并重启本地服务。"}</p>}
    {status && <div className="mt-3 rounded-xl bg-white/70 px-4 py-3 text-xs leading-6 text-[#52694b]"><strong>纽约日期 {status.dailyBudget.day} · 每日上限 {status.dailyBudget.limit === null ? "不限" : `${status.dailyBudget.limit} 次`} · 已用 {status.dailyBudget.used} · 剩余 {status.dailyBudget.remaining === null ? "不限" : status.dailyBudget.remaining}</strong><p>待审核队列 {status.pendingCandidates} 条。粗筛和缓存复用不占额度；有日期的候选只在发布当天审核，过日后跳过。无日期候选来自每个来源的前 50 条，超过 7 天清理。</p>{paused ? <p>当前只进行抓取、粗筛和缓存复用。调整并保存额度后可继续审核队列。</p> : exhausted && <p>可上调额度后继续，或等待 {new Date(status.dailyBudget.resetsAt).toLocaleString("zh-CN", { timeZone: "America/New_York", hour12: false })}（纽约时间）恢复。</p>}</div>}
    {status?.latestScreening && <p className="mt-3 text-xs leading-6 text-[#52694b]">最近完成的筛选（同步 #{status.latestScreening.id}）：本地粗筛拒绝 {status.latestScreening.ai_rule_rejected} 条 · 缓存复用 {status.latestScreening.ai_cache_hits} 次 · AI 请求 {status.latestScreening.ai_requests} 次。缓存命中可能包含同一职位的重复检查。</p>}
    {!!status?.pendingReview && <p className="mt-2 text-xs text-[#64725d]">还有 {status.pendingReview} 条旧职位待筛选，审核通过后才会出现在列表中；不符合条件的旧职位会清理，已保存的申请记录保留。</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
  </section>;
}
