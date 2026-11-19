"use client";

import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLanguage } from "../language-provider";
import { plannerCauses, plannerEntryKinds, plannerProjectKinds, plannerProjectStates, plannerTaskStates,
  type Card, type Entry, type PlannerCollection, type Project, type Task } from "@/lib/planner-types";
import type { plannerToday, plannerWeeklyReview } from "@/lib/planner-workflow";

export type TodayData = Awaited<ReturnType<typeof plannerToday>>;
export type WeekData = Awaited<ReturnType<typeof plannerWeeklyReview>>;
export type Draft = Record<string, unknown>;
export type Editor = { kind: PlannerCollection; seed?: Draft; row?: Draft & { id: number; version: number } };
type Context = {
  data: TodayData; ai: { available: boolean; reason: string };
  open: (editor: Editor) => void; chooseTab: (tab: Tab) => void; refresh: () => Promise<void>;
  saveTask: (task: Task, changes: Draft) => Promise<void>;
  completeTask: (task: Task) => void;
  requestAI: <T>(value: Draft) => Promise<T>;
  editLimit: (field: "max_active_projects" | "max_doing_tasks") => void;
  breakdown: (project: Project, task?: Task) => void;
  reviewProject: (id: number) => void; reviewOnlyProject: number | null;
};
export const plannerTabs = ["今天", "项目", "记录", "复习", "每周回顾"] as const;
export type Tab = typeof plannerTabs[number];
export const PlannerContext = createContext<Context | null>(null);
export function usePlanner() {
  const context = useContext(PlannerContext);
  if (!context) throw Error("Planner context unavailable");
  return context;
}
export class PlannerApiError extends Error {
  constructor(message: string, readonly limit?: "max_active_projects" | "max_doing_tasks", readonly count?: number, readonly max?: number) { super(message); }
}
export async function plannerApi<T = Draft>(path: string, method = "GET", payload?: Draft): Promise<T> {
  const result = await fetch(`/api/planner/${path}`, { method, cache: "no-store",
    ...(payload ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : {}) });
  const json: unknown = await result.json();
  if (!result.ok) {
    const data = json as { error?: string; limit?: PlannerApiError["limit"]; count?: number; max?: number };
    throw new PlannerApiError(data.error ?? "计划操作失败，请重试", data.limit, data.count, data.max);
  }
  return json as T;
}

export const panel = "min-w-0 rounded-2xl border border-radar-line bg-white p-4 sm:p-5";
export const fieldStyle = "source-input w-full min-w-0";
export const wrap = "flex min-w-0 flex-wrap items-center gap-2";
export function Action({ children, onClick, disabled, title, primary = false, submit = false }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; title?: string; primary?: boolean; submit?: boolean;
}) {
  return <button type={submit ? "submit" : "button"} onClick={onClick} disabled={disabled} title={title}
    className={`${primary ? "sync-button" : "icon-button"} min-w-0 max-w-full whitespace-normal text-sm disabled:opacity-50`}>{children}</button>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid min-w-0 gap-1 text-sm font-medium text-radar-muted"><span>{label}</span>{children}</label>;
}
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); onClose(); }}
    className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-radar-line bg-white p-5 text-radar-ink shadow-xl backdrop:bg-black/35">
    <div className="mb-4 flex min-w-0 items-center justify-between gap-2"><h2 className="break-words text-lg font-semibold">{title}</h2>
      <Action onClick={onClose}>{t("关闭")}</Action></div>{children}
  </dialog>;
}
export function ErrorLine({ error }: { error: string }) {
  const { t } = useLanguage();
  return error ? <p role="alert" className="my-2 break-words text-sm text-red-700">{t(error)}</p> : null;
}
export function LimitBadge({ count, limit, onChange }: { count: number; limit: number | null; onChange: () => void }) {
  const { t } = useLanguage();
  return <div className={wrap}>
    <span className="text-sm text-radar-muted">{t("进行中 {0}/{1}", count, limit ?? t("不限"))}</span>
    {limit !== null && count > limit && <span className="text-sm text-amber-800">{t("当前 {0} 个，超出上限 {1} 个", count, count - limit)}</span>}
    <Action onClick={onChange}>{t("修改上限")}</Action>
  </div>;
}

export const labels: Record<string, string> = {
  active: "进行中", archived: "归档", paused: "暂停", done: "完成", dropped: "放弃", open: "未完成", next: "待办", doing: "进行中", blocked: "卡住",
  project: "项目", learning: "学习", code: "代码项目", progress: "进展", insight: "理解", mistake: "踩坑", decision: "决策",
  metric: "数据", artifact: "产出", underestimated: "低估工作量", environment: "环境问题", unclear: "需求不清",
  interrupted: "被打断", dependency: "依赖未就绪", other: "其他",
};
const singular: Record<PlannerCollection, string> = { goals: "目标", projects: "项目", milestones: "里程碑", tasks: "任务", entries: "记录", cards: "复习卡" };
export function editorTitle(kind: PlannerCollection, edit: boolean) { return { action: edit ? "编辑 {0}" : "新增 {0}", item: singular[kind] }; }
type Option = [string, string];
const options = (values: readonly string[]): Option[] => values.map(value => [value, labels[value] ?? value]);
const nullable = (rows: Option[]): Option[] => [["", "未选择"], ...rows];

export function EntityForm({ editor, onSubmit, onDelete, busy, error }: {
  editor: Editor; onSubmit: (value: Draft) => void; onDelete?: () => void; busy: boolean; error: string;
}) {
  const { t } = useLanguage();
  const { data } = usePlanner();
  const [values, setValues] = useState<Draft>({ ...editor.row, ...editor.seed });
  const [deletePending, setDeletePending] = useState(false);
  const kind = editor.kind;
  const set = (key: string, value: unknown) => setValues(previous => ({ ...previous, [key]: value }));
  const str = (key: string, fallback = "") => values[key] == null ? fallback : String(values[key]);
  const text = (key: string, title: string, opt: { area?: boolean; required?: boolean; type?: string; default?: string } = {}) => <Field label={t(title)}>
    {opt.area ? <textarea rows={3} className={fieldStyle} value={str(key, opt.default)} required={opt.required} onChange={event => set(key, event.target.value)} /> :
      <input className={fieldStyle} type={opt.type ?? "text"} value={str(key, opt.default)} required={opt.required} onChange={event =>
        set(key, opt.type === "number" ? event.target.value === "" ? null : Number(event.target.value) : event.target.value)} />}
  </Field>;
  const select = (key: string, title: string, choices: Option[], fallback = "", numeric = false) => <Field label={t(title)}>
    <select className={fieldStyle} value={str(key, fallback)} onChange={event => set(key, numeric ? Number(event.target.value) || null : event.target.value || null)}>
      {choices.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></Field>;
  const list = (key: "skills" | "links", title: string) => <Field label={t(title)}><input className={fieldStyle}
    value={typeof values[key] === "string" ? values[key] as string : ((values[key] ?? []) as string[]).join(", ")}
    onChange={event => set(key, event.target.value)} /></Field>;
  const selectedStatus = str("status", kind === "tasks" ? "next" : "active");
  const metric = (values.metric ?? {}) as Partial<{ name: string; before: number; after: number; unit: string }>;
  const metricPart = (key: keyof typeof metric, title: string, number = false) => <Field label={t(title)}>
    <input className={fieldStyle} type={number ? "number" : "text"} step={number ? "any" : undefined} value={metric[key] ?? ""}
      onChange={event => set("metric", { ...metric, [key]: number ? event.target.value ? Number(event.target.value) : undefined : event.target.value })} />
  </Field>;
  function send(event: FormEvent) {
    event.preventDefault();
    const payload = { ...values };
    if (kind === "entries") {
      for (const key of ["links", "skills"]) if (typeof payload[key] === "string") payload[key] = (payload[key] as string).split(/[,，\n]/).map(x => x.trim()).filter(Boolean);
      if (metric.after === undefined && !metric.name) payload.metric = null;
    }
    if (kind === "tasks" && editor.row && editor.row.status !== "done" && selectedStatus === "done") {
      payload.completion = { insight: values.insight, metric_body: values.metric_body, mistake: values.mistake, cause: values.cause };
      if (payload.actual_minutes === undefined || payload.actual_minutes === null && values.actual_minutes === editor.row.actual_minutes) {
        payload.actual_minutes = values.estimate_minutes ?? null;
      }
    }
    onSubmit(payload);
  }
  return <form className="grid min-w-0 gap-3" onSubmit={send}>
    {kind !== "entries" && kind !== "cards" && text("title", "标题", { required: true })}
    {kind === "goals" && <>
      {text("why", "为什么做", { area: true })}
      {select("priority", "优先级", [["1", "1"], ["2", "2"], ["3", "3"]], "2", true)}
      {text("weekly_target_minutes", "每周目标分钟", { type: "number" })}
      {select("status", "状态", options(["active", "archived"]), "active")}
    </>}
    {kind === "projects" && <>
      {select("goal_id", "目标", nullable(data.state.goals.map(goal => [String(goal.id), goal.title])), "", true)}
      {select("kind", "项目类型", options(plannerProjectKinds), "project")}
      {text("description", "说明", { area: true })}
      {str("kind") === "code" && text("repo_path", "仓库路径")}
      {select("status", "状态", options(plannerProjectStates), "active")}
    </>}
    {kind === "milestones" && <>
      {text("done_criteria", "完成标准", { area: true })}
      {text("target_on", "目标日期", { type: "date" })}
      {text("position", "顺序", { type: "number" })}
      {select("status", "状态", options(["open", "done", "dropped"]), "open")}
    </>}
    {kind === "tasks" && <>
      {text("notes", "备注", { area: true })}
      {select("milestone_id", "里程碑", nullable(data.state.milestones.filter(row => row.project_id === values.project_id).map(row => [String(row.id), row.title])), "", true)}
      <div className="grid gap-2 sm:grid-cols-2">{text("due_on", "截止日期", { type: "date" })}
        {text("estimate_minutes", "预估分钟", { type: "number" })}</div>
      {select("status", "状态", options(plannerTaskStates), "next")}
      {selectedStatus === "blocked" && <>{text("blocked_reason", "卡住原因", { required: true })}{text("check_back_on", "回看日期", { type: "date", required: true })}</>}
      {selectedStatus === "done" && <>
        {text("actual_minutes", "实际用时（分钟）", { type: "number", default: str("estimate_minutes") })}
        {editor.row && editor.row.status !== "done" && <>
          {text("insight", "学到了什么", { area: true })}{text("metric_body", "有没有数据", { area: true })}{text("mistake", "有没有踩坑", { area: true })}
          {!!values.mistake && select("cause", "主要原因", nullable(options(plannerCauses)))}
          {(!!values.due_on && String(values.due_on) < data.today || Number(values.actual_minutes) > 1.5 * Number(values.estimate_minutes) && !!values.estimate_minutes)
            && select("delay_reason", "延期原因", nullable(options(plannerCauses)))}
        </>}
      </>}
    </>}
    {kind === "entries" && <>
      {select("project_id", "项目", nullable(data.state.projects.map(project => [String(project.id), project.title])), "", true)}
      {select("kind", "记录类型", options(plannerEntryKinds), "progress")}
      {text("body", "正文", { required: true, area: true })}
      {list("links", "链接（逗号分隔）")}{list("skills", "技能（逗号分隔）")}
      {str("kind") === "mistake" && select("cause", "主要原因", nullable(options(plannerCauses)))}
      {str("kind") === "metric" && <div className="grid gap-2 sm:grid-cols-2">
        {metricPart("name", "指标名称")}{metricPart("unit", "单位")}{metricPart("before", "之前", true)}{metricPart("after", "现在", true)}
      </div>}
      <label className={wrap}><input type="checkbox" checked={!!values.resume_candidate} onChange={event => set("resume_candidate", event.target.checked)} />{t("简历候选")}</label>
    </>}
    {kind === "cards" && <>{text("question", "问题", { required: true })}{text("answer", "答案", { area: true, required: true })}</>}
    <ErrorLine error={error} />
    {deletePending && <p className="text-sm text-red-700">{t("确认删除这条记录？")}</p>}
    <div className={wrap}>
      <Action primary submit disabled={busy}>{t("保存")}</Action>
      {onDelete && <Action disabled={busy} onClick={() => deletePending ? onDelete() : setDeletePending(true)}>{t(deletePending ? "确认删除" : "删除")}</Action>}
      {deletePending && <Action onClick={() => setDeletePending(false)}>{t("取消")}</Action>}
    </div>
  </form>;
}

export function EntryItem({ entry }: { entry: Entry }) {
  const { t, locale } = useLanguage();
  const { data, open } = usePlanner();
  return <article className="min-w-0 rounded-xl border border-radar-line p-3">
    <div className={wrap}><span className="tag">{t(labels[entry.kind] ?? entry.kind)}</span>
      <span className="text-xs text-radar-muted">{new Date(entry.created_at).toLocaleString(locale, { timeZone: "America/New_York" })}</span>
      {entry.resume_candidate === 1 && <span className="tag">{t("简历候选")}</span>}</div>
    <p className="mt-2 whitespace-pre-wrap break-words text-sm">{entry.body}</p>
    {!!entry.skills.length && <p className="mt-2 break-words text-xs text-radar-muted">{entry.skills.join(" · ")}</p>}
    {entry.metric && <p className="mt-2 break-words text-sm">{entry.metric.name} {entry.metric.before !== undefined ? `${entry.metric.before} → ` : ""}{entry.metric.after} {entry.metric.unit}</p>}
    {entry.links.map(link => <a key={link} className="mt-1 block break-all text-xs text-radar-blue underline" href={link} target="_blank" rel="noreferrer">{link}</a>)}
    <div className={`mt-2 ${wrap}`}><Action onClick={() => open({ kind: "entries", row: { ...entry } })}>{t("编辑")}</Action>
      {entry.kind === "insight" && data.state.projects.some(project => project.id === entry.project_id) &&
        <Action onClick={() => open({ kind: "cards", seed: { project_id: entry.project_id, entry_id: entry.id, answer: entry.body } })}>{t("做成卡片")}</Action>}
    </div>
  </article>;
}

export function cardForProject(cards: Card[], project: number | null, today: string) {
  return cards.filter(card => card.due_on <= today && (project === null || card.project_id === project));
}
