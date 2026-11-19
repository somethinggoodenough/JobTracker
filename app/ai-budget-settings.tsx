"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLanguage } from "./language-provider";

export type DailyBudget = { day: string; limit: number | null; used: number; remaining: number | null; resetsAt: string };
export default function AiBudgetSettings({ budget, onSaveStart, onSaved }: { budget: DailyBudget; onSaveStart: () => void; onSaved: (budget: DailyBudget) => void }) {
  const { t } = useLanguage();
  const [limit, setLimit] = useState(budget.limit === null ? "" : String(budget.limit));
  const [unlimited, setUnlimited] = useState(budget.limit === null), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) { setUnlimited(budget.limit === null); setLimit(budget.limit === null ? "" : String(budget.limit)); }
  }, [budget.limit]);
  function changed() { dirty.current = true; setNotice(""); setError(""); }
  async function save(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    const dailyLimit = unlimited ? null : Number(limit);
    if (dailyLimit !== null && (!limit.trim() || !Number.isSafeInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 1_000_000)) {
      setError("请填写 0–1000000 的整数，或选择不设上限"); return;
    }
    setSaving(true); onSaveStart();
    try {
      const response = await fetch("/api/ai/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ dailyLimit }) });
      const data = await response.json() as { dailyBudget?: DailyBudget; error?: string };
      if (!response.ok || !data.dailyBudget) throw new Error(data.error || "保存额度失败");
      dirty.current = false; onSaved(data.dailyBudget);
      setUnlimited(data.dailyBudget.limit === null); setLimit(data.dailyBudget.limit === null ? "" : String(data.dailyBudget.limit));
      setNotice("已保存，对后续 AI 请求生效；今日已用次数保持不变。");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  }
  return <form onSubmit={save} className="mt-4 rounded-xl border border-radar-border bg-white/80 p-4" aria-label={t("每日 AI 筛选额度设置")}>
    <label htmlFor="daily-ai-limit" className="block text-sm font-medium text-radar-strong">{t("每日 AI 筛选额度")}</label>
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <input id="daily-ai-limit" type="number" min="0" max="1000000" step="1" required={!unlimited} disabled={unlimited || saving} value={limit} onChange={event=>{changed();setLimit(event.target.value);}} className="source-input w-36 disabled:opacity-50" />
      <span className="text-xs text-radar-muted">{t("次请求 / 纽约日历日")}</span>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-radar-muted"><input type="checkbox" checked={unlimited} disabled={saving} onChange={event=>{changed();setUnlimited(event.target.checked);}} className="accent-radar-strong" />{t("不设上限")}</label>
      <button type="submit" disabled={saving} className="sync-button">{saving ? t("保存中…") : t("保存额度")}</button>
    </div>
    <p className="mt-2 text-xs leading-6 text-radar-muted">{t("可自行填写额度，设为 0 暂停 AI。一个岗位通常需要 1 次请求，异常重试和格式纠正也计数。粗筛和缓存复用不占额度；保存设置不会清零今日已用次数。")}</p>
    {notice && <p role="status" className="mt-2 text-xs text-radar-strong">{t(notice)}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{t(error)}</p>}
  </form>;
}
