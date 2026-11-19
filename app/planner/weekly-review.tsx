"use client";

import { useEffect, useState } from "react";
import { plannerCauses } from "@/lib/planner-types";
import { useLanguage } from "../language-provider";
import { Action, ErrorLine, Field, fieldStyle, labels, panel, plannerApi, usePlanner, wrap, type WeekData } from "./shared";
import { TaskLine } from "./today";

const steps = ["检查进行中项目", "清理卡住任务", "时间分配", "规律", "简历候选"] as const;

export default function WeeklyReviewTab() {
  const { t, locale } = useLanguage();
  const { data, ai, open, requestAI, refresh, saveTask } = usePlanner();
  const [week, setWeek] = useState(data.week);
  const [view, setView] = useState<WeekData | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    void plannerApi<WeekData>(`review?week=${week}`).then(result => {
      if (!current) return;
      setView(result);
      setDone(result.notes.steps ?? []);
      setNote(result.notes.note ?? "");
      setSelected(result.entries.filter(entry => entry.resume_candidate).map(entry => entry.id));
      setSuggestions(result.notes.suggestions ?? []);
      setError("");
    }).catch(err => { if (current) setError(err.message); });
    return () => { current = false; };
  }, [week]);
  useEffect(() => {
    let current = true;
    if (view?.week === week) void plannerApi<WeekData>(`review?week=${week}`).then(result => {
      if (current) setView(result);
    }).catch(err => { if (current) setError(err.message); });
    return () => { current = false; };
    // Refresh derived data after project or task mutations while preserving the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  async function summarize() {
    setBusy(true); setError("");
    try {
      const draft = await requestAI<{ suggestions: string[] }>({ action: "patterns", week });
      setSuggestions(draft.suggestions);
    } catch (err) { setError(err instanceof Error ? err.message : "AI 结果无法解析"); }
    finally { setBusy(false); }
  }
  async function finish() {
    if (done.includes(steps[0]) && data.stalled.length) { setError("请为停滞项目补下一步或暂停项目"); return; }
    setBusy(true); setError("");
    try {
      const saved = await plannerApi<WeekData>(`review?week=${week}`, "POST", { version: view?.version, notes: { steps: done, note, suggestions },
        ...(done.includes(steps[4]) ? { resume_entry_ids: selected } : {}) });
      setView(saved); await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "计划操作失败，请重试"); }
    finally { setBusy(false); }
  }
  const scale = Math.max(1, ...(view?.time ?? []).flatMap(row => [row.actual, row.target ?? 0]));
  const samples = view ? Math.max(view.patterns.sampleSize, Object.values(view.patterns.delay).reduce((a,b) => a+b,0) +
    Object.values(view.patterns.causes).reduce((a,b) => a+b,0)) : 0;
  function step(index: number, content: React.ReactNode) {
    const name = steps[index];
    return <details className={panel} open={index === 0}><summary className="cursor-pointer font-semibold">{t(name)}</summary>
      <div className="mt-3 space-y-3">{content}
        <label className={`${wrap} text-sm`}><input type="checkbox" checked={done.includes(name)}
          onChange={event => setDone(current => event.target.checked ? [...current, name] : current.filter(item => item !== name))} />{t("标记此步已检查")}</label>
      </div></details>;
  }
  return <div className="space-y-3">
    <section className={`${panel} space-y-3`}><h2 className="text-lg font-semibold">{t("每周回顾")}</h2>
      <Field label={t("周一日期")}><input className={`${fieldStyle} sm:max-w-xs`} type="date" value={week}
        onChange={event => { if (event.target.value) { setView(null); setWeek(event.target.value); } }} /></Field>
      {view?.completed_at && <p className="text-sm text-radar-muted">{t("已完成于 {0}", new Date(view.completed_at).toLocaleString(locale, { timeZone: "America/New_York" }))}</p>}
      <ErrorLine error={error} />
    </section>
    {view && <>
      {step(0, data.state.projects.filter(row => row.status === "active").map(project => {
        const milestone = data.state.milestones.find(row => row.project_id === project.id && row.status === "open");
        return <article key={project.id} className="min-w-0 space-y-2 rounded-xl border border-radar-line p-3">
          <h3 className="break-words font-medium">{project.title}</h3>
          {data.stalled.some(row => row.id === project.id) && <p className="text-sm text-amber-800">{t("缺少下一步")}</p>}
          {milestone && <p className="break-words text-xs text-radar-muted">{t(milestone.title)} · {milestone.target_on ?? t("未设置日期")}</p>}
          <div className={wrap}>
            <Action onClick={() => open({ kind: "tasks", seed: { project_id: project.id, milestone_id: milestone?.id } })}>{t("添加下一步")}</Action>
            {milestone && <Action onClick={() => open({ kind: "milestones", row: { ...milestone } })}>{t("编辑里程碑")}</Action>}
            <Action onClick={() => open({ kind: "projects", row: { ...project } })}>{t("编辑项目状态")}</Action>
          </div>
        </article>;
      }))}
      {step(1, data.state.tasks.filter(task => task.status === "blocked").map(task =>
        <TaskLine key={task.id} task={task} extra={<Action onClick={() => void saveTask(task, { status: "dropped" })}>{t("放弃")}</Action>} />))}
      {step(2, <div className="space-y-2">{view.time.map(row => <div key={row.id} className="space-y-1">
        <div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{row.title}</strong><span>{t("实际 {0} 分钟 · 目标 {1}", row.actual, row.target ?? t("未设定"))}</span></div>
        <div className="h-2 rounded-full bg-radar-rule"><div className="h-full rounded-full bg-radar-blue" style={{ width: `${row.actual / scale * 100}%` }} /></div>
        {row.target !== null && <div className="h-1.5 rounded-full bg-radar-rule"><div className="h-full rounded-full bg-radar-muted" style={{ width: `${row.target / scale * 100}%` }} /></div>}
      </div>)}</div>)}
      {step(3, <>
        <p className="text-sm text-radar-muted">{t("近四周预估与实际用时比值中位数")} · {view.patterns.median?.toFixed(2) ?? "—"}</p>
        <ul className="grid gap-2 sm:grid-cols-2">{plannerCauses.map(cause => <li key={cause} className="text-sm">
          {t(labels[cause])} · {t("延期 {0} 次，踩坑 {1} 次", view.patterns.delay[cause], view.patterns.causes[cause])}</li>)}</ul>
        <Action disabled={busy || !ai.available || samples < 3} title={t(ai.reason || (samples < 3 ? "数据不足，至少需要三条样本" : "AI 总结"))}
          onClick={() => void summarize()}>{t("AI 总结")}</Action>
        {!!suggestions.length && <div className="space-y-2">
          <Field label={t("总结草稿")}><textarea className={fieldStyle} rows={4} value={suggestions.join("\n")} onChange={event => setSuggestions(event.target.value.split("\n"))} /></Field>
          <Action onClick={() => setSuggestions([])}>{t("移除草稿")}</Action>
        </div>}
      </>)}
      {step(4, view.entries.map(entry => <label key={entry.id} className="flex min-w-0 items-start gap-2 text-sm">
        <input className="mt-0.5" type="checkbox" checked={selected.includes(entry.id)}
          onChange={event => { setDone(current => current.includes(steps[4]) ? current : [...current, steps[4]]);
            setSelected(current => event.target.checked ? [...current, entry.id] : current.filter(id => id !== entry.id)); }} />
        <span className="break-words [overflow-wrap:anywhere]">{entry.body}</span></label>))}
      <section className={`${panel} space-y-3`}><Field label={t("回顾备注")}><textarea className={fieldStyle} value={note}
        onChange={event => setNote(event.target.value)} rows={3} /></Field>
        <Action primary disabled={busy} onClick={() => void finish()}>{t("完成回顾")}</Action></section>
    </>}
  </div>;
}
