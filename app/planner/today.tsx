"use client";

import { useState } from "react";
import { useLanguage } from "../language-provider";
import type { FocusItem } from "@/lib/planner-rank";
import type { Task } from "@/lib/planner-types";
import { Action, Dialog, ErrorLine, Field, fieldStyle, labels, LimitBadge, panel, plannerApi, usePlanner, wrap, type TodayData } from "./shared";

export function TaskLine({ task, extra }: { task: Task; extra?: React.ReactNode }) {
  const { t } = useLanguage();
  const { data, open, saveTask, completeTask, breakdown, ai } = usePlanner();
  const project = data.state.projects.find(row => row.id === task.project_id);
  return <div className="min-w-0 space-y-2">
    <div className={wrap}><strong className="break-words text-sm [overflow-wrap:anywhere]">{t(task.title)}</strong>
      <span className="tag">{t(labels[task.status])}</span>
      {task.due_on && <span className={task.due_on < data.today && task.status !== "done" ? "text-xs text-red-700" : "text-xs text-radar-muted"}>{task.due_on}</span>}
      {task.estimate_minutes && <span className="text-xs text-radar-muted">{t("{0} 分钟", task.estimate_minutes)}</span>}
      {((task.estimate_minutes ?? 0) > 120 || task.rollover_count >= 3) && <span className="text-xs font-medium text-amber-800">{t("建议拆分")}</span>}
    </div>
    {task.status === "blocked" && <p className="break-words text-sm text-radar-muted">{task.blocked_reason} · {t("回看日期")} {task.check_back_on}</p>}
    <div className={wrap}>
      {task.status === "next" && <Action onClick={() => void saveTask(task, { status: "doing" })}>{t("开始任务")}</Action>}
      {["next", "doing", "blocked"].includes(task.status) && <Action onClick={() => completeTask(task)}>{t("完成")}</Action>}
      {["next", "doing"].includes(task.status) && <Action onClick={() => open({ kind: "tasks", row: { ...task }, seed: { status: "blocked" } })}>{t("卡住")}</Action>}
      {task.status === "blocked" && <Action onClick={() => void saveTask(task, { status: "next" })}>{t("解除卡点")}</Action>}
      <Action onClick={() => open({ kind: "tasks", row: { ...task } })}>{t("编辑")}</Action>
      {project && ["next", "doing", "blocked"].includes(task.status) &&
        <Action title={ai.reason ? t(ai.reason) : undefined} disabled={!ai.available} onClick={() => breakdown(project, task)}>{t("AI 拆分")}</Action>}
      {extra}
    </div>
  </div>;
}

export default function TodayTab() {
  const { t } = useLanguage();
  const { data, ai, editLimit, open, chooseTab, breakdown, refresh, reviewProject } = usePlanner();
  const [skip, setSkip] = useState(false);
  const [proposal, setProposal] = useState<TodayData | null>(null);
  const [draft, setDraft] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState("");
  const [other, setOther] = useState<number | null>(null);
  const ranked = proposal ?? data;
  const activeTasks = data.state.tasks.filter(task => task.status === "doing");
  const picked = data.day?.started_at ? data.day.focus_task_ids : draft ?? ranked.focus.map(row => row.id);
  const unfinished = data.state.tasks.filter(task => picked.includes(task.id) && !["done", "dropped"].includes(task.status));
  const byId = new Map(ranked.candidates.map(item => [item.id, item]));
  const warnings = new Map(data.stale.map(project => [project.id, { project, stale: true, stalled: false }]));
  for (const project of data.stalled) warnings.set(project.id, { project, stalled: true, stale: warnings.has(project.id) });
  async function submit(path: string, payload: Record<string, unknown>) {
    setBusy(true); setError("");
    try { await plannerApi(path, "POST", payload); setClosing(false); setProposal(null); setDraft(null); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "计划操作失败，请重试"); }
    finally { setBusy(false); }
  }
  async function resize(minutes: number) {
    setBusy(true); setError("");
    try { setProposal(await plannerApi<TodayData>(`today?minutes=${minutes}`)); setDraft(null); }
    catch (err) { setError(err instanceof Error ? err.message : "计划操作失败，请重试"); }
    finally { setBusy(false); }
  }
  function editFocus(id: number, replacement?: number) {
    const next = replacement ? picked.map(item => item === replacement ? id : item) :
      picked.includes(id) ? picked.filter(item => item !== id) : [...picked, id];
    const project = byId.get(id)?.project_id;
    if (next.length > 3) { setError("最多选择三项焦点"); return; }
    if (project && next.filter(item => byId.get(item)?.project_id === project).length > 2) { setError("同一项目最多设置两个焦点"); return; }
    setDraft(next); setOther(null); setError("");
  }
  const reasonText = (item?: FocusItem) => (item?.reasons ?? []).filter(reason => reason.value > 0).sort((a, b) => b.value - a.value).slice(0, 2)
    .map(reason => t(reason.label, ...(reason.args ?? []))).join(" · ");
  const itemTitle = (id: number) => id < 0 ? t("复习 {0} 张卡片", ranked.reviewCounts[-id] ?? 0) :
    t(data.state.tasks.find(task => task.id === id)?.title ?? "任务已移除");
  return <div className="space-y-4">
    {(warnings.size > 0 || data.remindReview || data.pendingInterviews > 0) && <section className={`${panel} space-y-3`}>
      {[...warnings.values()].map(({ project, stale, stalled }) => <div key={project.id} className="min-w-0 space-y-2">
        <p className="break-words text-sm font-medium text-amber-800">{project.title} · {[stalled && t("缺少下一步"), stale && t("最近 7 天未推进")].filter(Boolean).join(" · ")}</p>
        {stalled && <div className={wrap}>
          <Action onClick={() => open({ kind: "tasks", seed: { project_id: project.id } })}>{t("添加下一步")}</Action>
          <Action title={ai.reason ? t(ai.reason) : undefined} disabled={!ai.available} onClick={() => breakdown(project)}>{t("AI 拆分")}</Action>
        </div>}
      </div>)}
      {data.remindReview && <div className={wrap}><span className="text-sm">{t("本周回顾待完成")}</span><Action onClick={() => chooseTab("每周回顾")}>{t("每周回顾")}</Action></div>}
      {!!data.pendingInterviews && <div className={wrap}><span className="text-sm">{t("有 {0} 条申请需要面试准备。先创建「求职」项目。", data.pendingInterviews)}</span>
        <Action onClick={() => open({ kind: "projects", seed: { title: "求职", kind: "project" } })}>{t("创建求职项目")}</Action></div>}
    </section>}
    <section className={`${panel} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{t("今日焦点")}</h2>
        <span className="text-xs text-radar-muted">{data.today} · {t("纽约时间")}</span></div>
      {!data.day?.started_at && !skip && <div className="grid gap-3 rounded-xl bg-radar-soft p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Field label={t("今天的可用时间")}><select className={fieldStyle} value={ranked.available} disabled={busy} onChange={event => void resize(Number(event.target.value))}>
          {[60, 120, 240, 360, 480].map(minutes => <option key={minutes} value={minutes}>{minutes === 480 ? t("更多时间（8 小时）") : t("{0} 小时", minutes / 60)}</option>)}
        </select></Field>
        <div className={wrap}><Action primary disabled={busy} onClick={() => void submit("day", { action: "start", available_minutes: ranked.available, focus_task_ids: picked })}>{t("开始今天")}</Action>
          <Action onClick={() => { setSkip(true); setProposal(null); setDraft(null); }}>{t("跳过")}</Action></div>
      </div>}
      {!data.day?.started_at && skip && <div><Action onClick={() => setSkip(false)}>{t("设置今天的焦点")}</Action></div>}
      {!picked.length && <p className="text-sm text-radar-muted">{t("还没有焦点任务")}</p>}
      {picked.map(id => {
        const task = data.state.tasks.find(row => row.id === id);
        const eligible = byId.get(id);
        return <article key={id} className="min-w-0 rounded-xl border border-radar-line p-3">
          {task ? <TaskLine task={task} extra={!data.day?.started_at && <Action onClick={() => editFocus(id)}>{t("移出焦点")}</Action>} /> :
            <div className={wrap}><strong className="break-words text-sm">{itemTitle(id)}</strong>
              {id < 0 && <Action onClick={() => reviewProject(-id)}>{t("开始复习")}</Action>}
              {!data.day?.started_at && <Action onClick={() => editFocus(id)}>{t("移出焦点")}</Action>}</div>}
          {reasonText(eligible) && <p className={`mt-2 text-xs ${eligible?.overdue ? "text-red-700" : "text-radar-muted"}`}>{reasonText(eligible)}</p>}
        </article>;
      })}
      {data.day?.started_at && !data.day.closed_at && <div><Action primary onClick={() => { setError(""); setClosing(true); }}>{t("结束今天")}</Action></div>}
      {data.day?.closed_at && <p className="break-words text-sm text-radar-muted">{t("今天已结束")}{data.day.note && ` · ${data.day.note}`}</p>}
    </section>
    <section className={`${panel} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{t("进行中任务")}</h2>
        <LimitBadge count={activeTasks.length} limit={data.settings.max_doing_tasks} onChange={() => editLimit("max_doing_tasks")} /></div>
      {activeTasks.length ? activeTasks.map(task => <TaskLine key={task.id} task={task} />) : <p className="text-sm text-radar-muted">{t("没有进行中的任务")}</p>}
    </section>
    <section className={`${panel} space-y-3`}>
      <h2 className="text-lg font-semibold">{t("回看")}</h2>
      {data.checkBack.length ? data.checkBack.map(task => <TaskLine key={task.id} task={task} />) : <p className="text-sm text-radar-muted">{t("今天没有到期的回看")}</p>}
    </section>
    <details className={panel}><summary className="cursor-pointer font-semibold">{t("其他候选")}</summary>
      <div className="mt-3 space-y-2">{ranked.candidates.filter(item => !picked.includes(item.id)).map(item => <div key={item.id} className={wrap}>
        <span className="min-w-0 break-words text-sm">{itemTitle(item.id)}</span>
        {reasonText(item) && <span className="text-xs text-radar-muted">{reasonText(item)}</span>}
        {!data.day?.started_at && <Action onClick={() => picked.length < 3 ? editFocus(item.id) : setOther(item.id)}>{t("换进焦点")}</Action>}
      </div>)}</div>
    </details>
    {!closing && <ErrorLine error={error} />}
    {other !== null && <Dialog title={t("替换焦点任务")} onClose={() => setOther(null)}><div className={wrap}>
      {picked.map(id => <Action key={id} onClick={() => editFocus(other, id)}>{itemTitle(id)}</Action>)}
    </div></Dialog>}
    {closing && <CloseDayDialog tasks={unfinished} onClose={() => setClosing(false)} onSave={(tasks, note) => void submit("day", { action: "close", tasks, note })}
      busy={busy} error={error} />}
  </div>;
}

function CloseDayDialog({ tasks, onClose, onSave, busy, error }: {
  tasks: Task[]; onClose: () => void; onSave: (tasks: Record<string, unknown>[], note: string) => void; busy: boolean; error: string;
}) {
  const { t } = useLanguage();
  const [choices, setChoices] = useState<Record<number, string>>({});
  return <Dialog title={t("结束今天")} onClose={onClose}><form className="grid gap-3" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    onSave(tasks.map(task => ({ id: task.id, action: choices[task.id] ?? "continue",
      blocked_reason: form.get(`reason-${task.id}`), check_back_on: form.get(`date-${task.id}`) })), String(form.get("note") ?? ""));
  }}>
    {tasks.map(task => <div key={task.id} className="space-y-2">
      <Field label={task.title}><select className={fieldStyle} value={choices[task.id] ?? "continue"} onChange={event =>
        setChoices(current => ({ ...current, [task.id]: event.target.value }))}>
        <option value="continue">{t("明天继续")}</option><option value="backlog">{t("退回待办")}</option><option value="blocked">{t("卡住")}</option>
      </select></Field>
      {choices[task.id] === "blocked" && <>
        <Field label={t("卡住原因")}><input className={fieldStyle} name={`reason-${task.id}`} defaultValue={task.blocked_reason ?? ""} required /></Field>
        <Field label={t("回看日期")}><input className={fieldStyle} type="date" name={`date-${task.id}`} defaultValue={task.check_back_on ?? ""} required /></Field>
      </>}
    </div>)}
    <Field label={t("今日一句话")}><textarea className={fieldStyle} name="note" rows={2} /></Field>
    <ErrorLine error={error} /><div><Action primary submit disabled={busy}>{t("确认结束")}</Action></div>
  </form></Dialog>;
}
