"use client";
import { useEffect, useRef, useState } from "react";
import { estimateAiCost } from "@/lib/ai-cost";
import AiBudgetSettings, { type DailyBudget } from "./ai-budget-settings";
import ScreeningSettingsEditor from "./screening-settings";
import { useLanguage } from "./language-provider";
type Usage = { model: string; calls: number; prompt_tokens: number; completion_tokens: number; cached_tokens: number };
type Status = { configured: boolean; model: string; pendingReview: number; pendingCandidates: number; usage: Usage[];
  dailyBudget: DailyBudget; latestScreening: { id: number; ai_rule_rejected: number; ai_cache_hits: number; ai_requests: number } | null };
export default function AiFilterPanel({ active, onReview }: { active: boolean; onReview: () => void }) {
  const { locale, t } = useLanguage();
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
  return <section className="mb-6 rounded-2xl border border-[#cbd9c0] bg-[#eff5e7] p-5" aria-label={t("AI 筛选状态")}>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold text-[#305336]">{t("相关技术岗位，宽松纳入")}</h2><p className="mt-2 text-xs leading-6 text-[#64725d]">{t("软件 / AI / 数据科学 / 量化 / 技术方案 / 客户部署及相邻技术岗位，有相关职责即可考虑。")}<br />{t("Internship / New Grad / Junior · 工作地点中国或美国；先粗筛、去重和复用缓存，再交给 DeepSeek。")}<br />{t("美国岗位显示签证赞助状态，有明确原文时可在详情中查看。")}<br />{t("有发布日期只抓纽约当天发布的岗位；无发布日期时每个来源最多取前 50 条。")}</p></div>
      {!!status && (status.pendingReview>0 || status.pendingCandidates>0) && <button disabled={active || !status.configured || exhausted} onClick={onReview} className="sync-button">{active ? t("筛选进行中…") : paused ? t("AI 筛选已暂停") : exhausted ? t("今日额度已用完") : t("审核排队职位")}</button>}
    </div>
    {status && <AiBudgetSettings budget={status.dailyBudget} onSaveStart={()=>{statusVersion.current++;}} onSaved={dailyBudget=>{statusVersion.current++;setStatus(previous=>previous?{...previous,dailyBudget}:previous);}} />}
    <ScreeningSettingsEditor active={active} />
    {status && <p className={`mt-3 text-xs leading-6 ${status.configured ? "text-[#64725d]" : "text-red-700"}`}>{status.configured ? t("模型：{0} · 本月实际模型请求 {1} 次{2}（按官方高低峰价格估算，以账单为准）", status.model, status.usage.reduce((n, r) => n+r.calls, 0), cost ? t(" · 本月估算 ${0}–${1}", cost.low.toFixed(2), cost.high.toFixed(2)) : "") : t("未读取到 DeepSeek 密钥，暂时不能收录新职位。请检查 .env 并重启本地服务。")}</p>}
    {status && <div className="mt-3 rounded-xl bg-white/70 px-4 py-3 text-xs leading-6 text-[#52694b]"><strong>{t("纽约日期 {0} · 每日上限 {1} · 已用 {2} · 剩余 {3}", status.dailyBudget.day, status.dailyBudget.limit ?? t("不限"), status.dailyBudget.used, status.dailyBudget.remaining ?? t("不限"))}</strong><p>{t("待审核队列 {0} 条。粗筛和缓存复用不占额度；有日期的候选只在发布当天审核，过日后跳过。无日期候选来自每个来源的前 50 条，超过 7 天清理。", status.pendingCandidates)}</p>{paused ? <p>{t("当前只进行抓取、粗筛和缓存复用。调整并保存额度后可继续审核队列。")}</p> : exhausted && <p>{t("可上调额度后继续，或等待 {0}（纽约时间）恢复。", new Date(status.dailyBudget.resetsAt).toLocaleString(locale, { timeZone: "America/New_York", hour12: false }))}</p>}</div>}
    {status?.latestScreening && <p className="mt-3 text-xs leading-6 text-[#52694b]">{t("最近完成的筛选（同步 #{0}）：本地粗筛拒绝 {1} 条 · 缓存复用 {2} 次 · AI 请求 {3} 次。缓存命中可能包含同一职位的重复检查。", status.latestScreening.id, status.latestScreening.ai_rule_rejected, status.latestScreening.ai_cache_hits, status.latestScreening.ai_requests)}</p>}
    {!!status?.pendingReview && <p className="mt-2 text-xs text-[#64725d]">{t("还有 {0} 条旧职位待筛选，审核通过后才会出现在列表中；不符合条件的旧职位会清理，已保存的申请记录保留。", status.pendingReview)}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{t(error)}</p>}
  </section>;
}
