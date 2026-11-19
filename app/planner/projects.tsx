"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "../language-provider";
import type { Entry, Task } from "@/lib/planner-types";
import { Action, EntryItem, ErrorLine, labels, LimitBadge, panel, plannerApi, usePlanner, wrap } from "./shared";
import { TaskLine } from "./today";

export default function ProjectsTab() {
  const { t } = useLanguage();
  const { data, open, editLimit, refresh } = usePlanner();
  const [selected, setSelected] = useState<number | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState<Task | null>(null);
  const active = data.state.projects.filter(row => row.status === "active");
  const project = data.state.projects.find(row => row.id === selected) ?? active[0] ?? data.state.projects[0];
  const projectId = project?.id;
  useEffect(() => {
    if (!projectId) return;
    let current = true;
    void plannerApi<Entry[]>(`entries?project=${projectId}`).then(items => { if (current) setEntries(items); })
      .catch(err => { if (current) setError(err.message); });
    return () => { current = false; };
  }, [projectId, data]);

  async function reorder(from: Task, to: Task) {
    if (from.id === to.id || from.milestone_id !== to.milestone_id) return;
    try {
      await plannerApi("tasks/reorder", "POST", { from: from.id, to: to.id, from_version: from.version, to_version: to.version });
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "计划操作失败，请重试"); }
  }
  function group(milestoneId: number | null) {
    const tasks = data.state.tasks.filter(task => task.project_id === projectId && task.milestone_id === milestoneId);
    return <div className="space-y-2">
      {tasks.map((task, index) => <article key={task.id} className="min-w-0 rounded-xl border border-radar-line p-3"
        onDragOver={event => { if (drag?.milestone_id === task.milestone_id) event.preventDefault(); }}
        onDrop={event => { event.preventDefault(); if (drag) void reorder(drag, task); setDrag(null); }}>
        <TaskLine task={task} extra={<><button type="button" className="icon-button cursor-grab" draggable aria-label={t("拖动任务排序")}
          onDragStart={event => { setDrag(task); event.dataTransfer.setData("text/plain", String(task.id)); }} onDragEnd={() => setDrag(null)}>↕</button>
          {index > 0 && <Action onClick={() => void reorder(task, tasks[index - 1])}>{t("上移")}</Action>}
          {index + 1 < tasks.length && <Action onClick={() => void reorder(task, tasks[index + 1])}>{t("下移")}</Action>}</>} />
      </article>)}
      <Action onClick={() => open({ kind: "tasks", seed: { project_id: projectId, milestone_id: milestoneId } })}>{t("添加下一步")}</Action>
    </div>;
  }
  return <div className="space-y-4">
    <section className={`${panel} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("项目")}</h2><LimitBadge count={active.length} limit={data.settings.max_active_projects} onChange={() => editLimit("max_active_projects")} />
      </div>
      <div className={wrap}><Action primary onClick={() => open({ kind: "projects" })}>{t("新增项目")}</Action>
        <Action onClick={() => open({ kind: "goals" })}>{t("新增目标")}</Action></div>
      {!!data.state.goals.length && <div className={wrap}>{data.state.goals.map(goal =>
        <Action key={goal.id} onClick={() => open({ kind: "goals", row: { ...goal } })}>{goal.title}</Action>)}</div>}
    </section>
    <ErrorLine error={error} />
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <aside className={`${panel} space-y-3`}>
        {["active", "paused", "done", "dropped"].map(status => {
          const rows = data.state.projects.filter(row => row.status === status);
          return rows.length > 0 && <div key={status} className="space-y-1"><h3 className="text-xs font-medium text-radar-muted">{t(labels[status])}</h3>
            {rows.map(row => <button type="button" key={row.id} onClick={() => { setEntries([]); setSelected(row.id); }} aria-pressed={projectId === row.id}
              className="block w-full break-words rounded-lg px-2 py-1.5 text-left text-sm hover:bg-radar-soft aria-pressed:bg-radar-soft [overflow-wrap:anywhere]">{row.title}</button>)}</div>;
        })}
        {!data.state.projects.length && <p className="text-sm text-radar-muted">{t("还没有项目")}</p>}
      </aside>
      {project && <section className={`${panel} space-y-4`}>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0"><h2 className="break-words text-xl font-semibold [overflow-wrap:anywhere]">{project.title}</h2>
            <p className="text-sm text-radar-muted">{t(labels[project.kind])} · {t(labels[project.status])}</p></div>
          <Action onClick={() => open({ kind: "projects", row: { ...project } })}>{t("编辑")}</Action>
        </div>
        {project.description && <p className="whitespace-pre-wrap break-words text-sm">{project.description}</p>}
        {project.repo_path && <p className="break-all text-xs text-radar-muted">{project.repo_path}</p>}
        <Action onClick={() => open({ kind: "milestones", seed: { project_id: project.id } })}>{t("新增里程碑")}</Action>
        {data.state.milestones.filter(row => row.project_id === project.id).map(milestone => <details key={milestone.id} open className="rounded-xl border border-radar-line p-3">
          <summary className="cursor-pointer break-words text-sm font-semibold">{t(milestone.title)} · {t(labels[milestone.status])} {milestone.target_on ?? ""}</summary>
          <div className="mt-3 space-y-3">{milestone.done_criteria && <p className="whitespace-pre-wrap break-words text-sm text-radar-muted">{milestone.done_criteria}</p>}
            <Action onClick={() => open({ kind: "milestones", row: { ...milestone } })}>{t("编辑里程碑")}</Action>
            {group(milestone.id)}</div>
        </details>)}
        <div className="space-y-2"><h3 className="font-semibold">{t("未分配里程碑的任务")}</h3>{group(null)}</div>
        <div className="space-y-2"><h3 className="font-semibold">{t("项目记录")}</h3>
          {entries.map(entry => <EntryItem key={entry.id} entry={entry} />)}
          <Action onClick={() => open({ kind: "entries", seed: { project_id: project.id } })}>{t("新增记录")}</Action>
        </div>
      </section>}
    </div>
  </div>;
}
