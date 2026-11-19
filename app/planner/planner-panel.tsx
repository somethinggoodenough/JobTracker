"use client";

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "../language-provider";
import type { Project, Task } from "@/lib/planner-types";
import { plannerCauses } from "@/lib/planner-types";
import { Action, Dialog, editorTitle, EntityForm, ErrorLine, Field, fieldStyle, labels, panel, PlannerApiError, PlannerContext,
  plannerApi, plannerTabs, usePlanner, wrap, type Draft, type Editor, type Tab, type TodayData } from "./shared";
import TodayTab from "./today";
import ProjectsTab from "./projects";
import RecordsTab from "./records";
import ReviewCardsTab from "./review-cards";
import WeeklyReviewTab from "./weekly-review";

type Mutation = { path: string; method: string; data: Draft };
type Conflict = { error: PlannerApiError; mutation: Mutation };
type Split = { project: Project; task?: Task; items: { title: string; estimate_minutes: number; keep: boolean }[] };

export default function PlannerPanel() {
  const { t, locale } = useLanguage();
  const [tab, setTab] = useState<Tab>("今天");
  const [data, setData] = useState<TodayData | null>(null);
  const [ai, setAi] = useState({ available: false, reason: "" });
  const [reviewProjectId, setReviewProjectId] = useState<number | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [complete, setComplete] = useState<Task | null>(null);
  const [limit, setLimit] = useState<"max_active_projects" | "max_doing_tasks" | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [replaceId, setReplaceId] = useState("");
  const [split, setSplit] = useState<Split | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => { setData(await plannerApi<TodayData>("today")); }, []);
  const refreshAi = useCallback(() => plannerApi<typeof ai>("ai").then(setAi).catch(() => setAi({ available: false, reason: "DeepSeek 暂时不可用" })), []);
  useEffect(() => { void refresh().catch(err => setError(err.message)); void refreshAi(); }, [refresh, refreshAi]);
  function reset() { setError(""); setEditor(null); setComplete(null); setLimit(null); setConflict(null); setSplit(null); setReplaceId(""); }
  async function mutate(mutation: Mutation) {
    setError("");
    setBusy(true);
    try {
      await plannerApi(mutation.path, mutation.method, mutation.data);
      reset();
      await refresh();
    } catch (err) {
      if (err instanceof PlannerApiError && err.limit) { setConflict({ error: err, mutation }); setReplaceId(""); }
      else setError(err instanceof Error ? err.message : "计划操作失败，请重试");
    } finally { setBusy(false); }
  }
  async function requestAI<T>(value: Draft) {
    try { return await plannerApi<T>("ai", "POST", { ...value, locale }); }
    finally { void refreshAi(); }
  }
  async function breakdown(project: Project, task?: Task) {
    if (busy || !ai.available) return;
    setError(""); setBusy(true);
    try {
      const { tasks } = await requestAI<{ tasks: Split["items"] }>({ action: "breakdown", project_id: project.id, task_id: task?.id });
      setSplit({ project, task, items: tasks.map(item => ({ ...item, keep: true })) });
    } catch (err) { setError(err instanceof Error ? err.message : "AI 结果无法解析"); }
    finally { setBusy(false); }
  }
  if (!data) return <section className={panel}><h1 className="text-2xl font-semibold">{t("计划")}</h1><ErrorLine error={error} />
    {!error && <p role="status" className="mt-3 text-sm text-radar-muted">{t("载入计划中…")}</p>}</section>;

  const entityLabel = editor && editorTitle(editor.kind, !!editor.row);
  const availableReplacements = conflict?.error.limit === "max_active_projects" ?
    data.state.projects.filter(row => row.status === "active") : data.state.tasks.filter(row => row.status === "doing");
  return <PlannerContext.Provider value={{
    data, ai, refresh, requestAI, chooseTab: setTab, open(value) { reset(); setEditor(value); },
    saveTask: (task, changes) => mutate({ path: `tasks/${task.id}`, method: "PATCH", data: { ...changes, version: task.version } }),
    completeTask(task) { reset(); setComplete(task); }, editLimit(field) { reset(); setLimit(field); },
    breakdown: (project, task) => { void breakdown(project, task); },
    reviewProject(id) { setReviewProjectId(id); setTab("复习"); }, reviewOnlyProject: reviewProjectId,
  }}>
    <section className="min-w-0 space-y-4">
      <div><h1 className="text-3xl font-semibold tracking-tight">{t("计划")}</h1></div>
      <QuickEntry />
      <nav aria-label={t("计划分类")} className="flex min-w-0 flex-wrap gap-1 rounded-xl border border-radar-line bg-white p-1">
        {plannerTabs.map(item => <button key={item} type="button" aria-current={item === tab ? "page" : undefined}
          className={`rounded-lg px-2.5 py-2 text-sm sm:px-4 ${item === tab ? "bg-radar-blue text-white" : "text-radar-muted hover:bg-radar-soft"}`}
          onClick={() => { setTab(item); if (item === "复习") setReviewProjectId(null); }}>{t(item)}</button>)}
      </nav>
      {!editor && !complete && !limit && !conflict && !split && <ErrorLine error={error} />}
      {tab === "今天" ? <TodayTab /> : tab === "项目" ? <ProjectsTab /> : tab === "记录" ? <RecordsTab /> : tab === "复习" ? <ReviewCardsTab /> : <WeeklyReviewTab />}
    </section>
    {editor && entityLabel && !conflict && <Dialog title={t(entityLabel.action, t(entityLabel.item))} onClose={reset}>
      <EntityForm key={`${editor.kind}-${editor.row?.id ?? 0}`} editor={editor} busy={busy} error={error}
        onSubmit={values => void mutate({ path: editor.row ? `${editor.kind}/${editor.row.id}` : editor.kind, method: editor.row ? "PATCH" : "POST", data: values })}
        onDelete={editor.row ? () => void mutate({ path: `${editor.kind}/${editor.row!.id}?version=${editor.row!.version}`, method: "DELETE", data: {} }) : undefined} />
    </Dialog>}
    {complete && !conflict && <CompletionDialog task={complete} today={data.today} onClose={reset} error={error} busy={busy}
      onSubmit={value => void mutate({ path: `tasks/${complete.id}`, method: "PATCH", data: { ...value, status: "done", version: complete.version } })} />}
    {limit && <Dialog title={t(limit === "max_active_projects" ? "进行中项目上限" : "进行中任务上限")} onClose={reset}>
      <form className="grid gap-3" onSubmit={event => {
        event.preventDefault(); const raw = new FormData(event.currentTarget).get("limit");
        void mutate({ path: "settings", method: "PATCH", data: { [limit]: raw === "" ? null : Number(raw), version: data.settings.version } });
      }}><Field label={t("上限")}><select name="limit" className={fieldStyle} defaultValue={data.settings[limit] ?? ""}>
        <option value="">{t("不限")}</option>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></Field>
        <ErrorLine error={error} /><div><Action submit primary disabled={busy}>{t("保存")}</Action></div>
      </form>
    </Dialog>}
    {conflict && <Dialog title={t("已达到进行中上限")} onClose={reset}>
      <p className="mb-3 text-sm text-radar-muted">{t("进行中 {0}/{1}", conflict.error.count ?? 0, conflict.error.max ?? 0)}</p>
      <Field label={t(conflict.error.limit === "max_active_projects" ? "选择要暂停的项目" : "选择要退回待办的任务")}>
        <select className={fieldStyle} value={replaceId} onChange={event => setReplaceId(event.target.value)}><option value="">{t("未选择")}</option>
          {availableReplacements.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
      </Field><ErrorLine error={error} />
      <div className={`mt-3 ${wrap}`}>
        <Action primary disabled={!replaceId || busy} onClick={() => void mutate({ ...conflict.mutation, data: { ...conflict.mutation.data, resolution: { action: "replace", id: Number(replaceId) } } })}>{t("换一个并继续")}</Action>
        <Action disabled={busy || (conflict.error.max ?? 10) >= 10} onClick={() => void mutate({ ...conflict.mutation, data: { ...conflict.mutation.data, resolution: { action: "increase" } } })}>{t("上限加 1 并继续")}</Action>
        <Action onClick={reset}>{t("取消")}</Action>
      </div>
    </Dialog>}
    {split && <Dialog title={t("拆分草稿")} onClose={reset}>
      <div className="space-y-2">{split.items.map((item, index) => <div key={index} className="grid grid-cols-[auto_minmax(0,1fr)_4rem] items-center gap-2">
        <input type="checkbox" aria-label={t("保留建议")} checked={item.keep} onChange={event =>
          setSplit({ ...split, items: split.items.map((row, i) => i === index ? { ...row, keep: event.target.checked } : row) })} />
        <input className={fieldStyle} aria-label={t("标题")} value={item.title} onChange={event =>
          setSplit({ ...split, items: split.items.map((row, i) => i === index ? { ...row, title: event.target.value } : row) })} />
        <input className={fieldStyle} type="number" aria-label={t("预估分钟")} min={1} max={120} value={item.estimate_minutes} onChange={event =>
          setSplit({ ...split, items: split.items.map((row, i) => i === index ? { ...row, estimate_minutes: Number(event.target.value) } : row) })} />
      </div>)}</div><ErrorLine error={error} /><div className="mt-3"><Action primary disabled={busy || !split.items.some(item => item.keep)}
        onClick={async () => {
          setBusy(true); setError("");
          try {
            for (const item of split.items.filter(row => row.keep)) {
              await plannerApi("tasks", "POST", { project_id: split.project.id, milestone_id: split.task?.milestone_id ?? null,
                title: item.title, estimate_minutes: item.estimate_minutes });
              setSplit(current => current && ({ ...current, items: current.items.filter(row => row !== item) }));
            }
            reset(); await refresh();
          } catch (err) { setError(err instanceof Error ? err.message : "计划操作失败，请重试"); }
          finally { setBusy(false); }
        }}>{t("保存所选任务")}</Action></div>
    </Dialog>}
  </PlannerContext.Provider>;
}

function QuickEntry() {
  const { t } = useLanguage();
  const { data, ai, refresh, open, requestAI } = usePlanner();
  const [body, setBody] = useState("");
  const [project, setProject] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recorded, setRecorded] = useState(false);
  const latest = [...data.state.projects].sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at))[0];
  const projectId = project === null ? latest?.id ?? null : Number(project) || null;
  async function save(organize: boolean) {
    setBusy(true); setError(""); setRecorded(false);
    try {
      if (organize) {
        const draft = await requestAI<Draft>({ action: "classify", body });
        open({ kind: "entries", seed: { ...draft, body, project_id: projectId } });
      } else {
        await plannerApi("entries", "POST", { body, project_id: projectId, kind: "progress" });
        setBody(""); setRecorded(true); await refresh();
      }
    } catch (err) { setError(err instanceof Error ? err.message : "计划操作失败，请重试"); }
    finally { setBusy(false); }
  }
  return <form className={`${panel} grid gap-2`} onSubmit={event => { event.preventDefault(); void save(false); }}>
    <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,1fr)] lg:grid-cols-[2fr_1fr_auto] lg:items-end">
      <Field label={t("快速记录")}><input className={fieldStyle} value={body} onChange={event => setBody(event.target.value)} required /></Field>
      <Field label={t("所属项目")}><select className={fieldStyle} value={projectId ?? ""} onChange={event => setProject(event.target.value)}>
        <option value="">{t("未选择")}</option>{data.state.projects.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></Field>
      <div className={wrap}><Action submit primary disabled={busy || !body.trim()}>{t("记录")}</Action>
        <Action title={ai.reason ? t(ai.reason) : undefined} disabled={!ai.available || busy || !body.trim()} onClick={() => void save(true)}>{t("AI 整理")}</Action></div>
    </div>
    {recorded && <p role="status" className="text-sm text-radar-muted">{t("已保存记录")}</p>}
    {!ai.available && ai.reason && <p className="text-xs text-radar-muted">{t(ai.reason)}</p>}
    <ErrorLine error={error} />
  </form>;
}

function CompletionDialog({ task, today, onClose, onSubmit, error, busy }: {
  task: Task; today: string; onClose: () => void; onSubmit: (value: Draft) => void; error: string; busy: boolean;
}) {
  const { t } = useLanguage();
  const [minutes, setMinutes] = useState(task.actual_minutes ?? task.estimate_minutes ?? "");
  const delay = !!task.due_on && task.due_on < today || !!task.estimate_minutes && Number(minutes) > task.estimate_minutes * 1.5;
  return <Dialog title={t("完成任务")} onClose={onClose}>
    <form className="grid gap-3" onSubmit={event => {
      event.preventDefault(); const values = new FormData(event.currentTarget);
      onSubmit({ actual_minutes: minutes === "" ? null : Number(minutes), delay_reason: delay ? values.get("reason") || null : null,
        completion: { insight: values.get("insight"), metric_body: values.get("metric"), mistake: values.get("mistake"), cause: values.get("cause") || null } });
    }}>
      <p className="break-words text-sm font-medium">{task.title}</p>
      <Field label={t("实际用时（分钟）")}><input type="number" min={0} className={fieldStyle} value={minutes} onChange={event => setMinutes(event.target.value)} /></Field>
      {([["insight", "学到了什么"], ["metric", "有没有数据"], ["mistake", "有没有踩坑"]] as const).map(([name, label]) =>
        <Field key={name} label={t(label)}><textarea name={name} rows={2} className={fieldStyle} /></Field>)}
      <Field label={t("踩坑原因")}><select name="cause" className={fieldStyle}><option value="">{t("未选择")}</option>
        {plannerCauses.map(cause => <option key={cause} value={cause}>{t(labels[cause])}</option>)}</select></Field>
      {delay && <Field label={t("主要原因")}><select name="reason" className={fieldStyle}><option value="">{t("未选择")}</option>
        {plannerCauses.map(cause => <option key={cause} value={cause}>{t(labels[cause])}</option>)}</select></Field>}
      <ErrorLine error={error} /><div><Action primary submit disabled={busy}>{t("确认完成")}</Action></div>
    </form>
  </Dialog>;
}
