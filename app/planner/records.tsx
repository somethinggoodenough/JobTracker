"use client";

import { useEffect, useState } from "react";
import type { Entry } from "@/lib/planner-types";
import { plannerEntryKinds } from "@/lib/planner-types";
import { useLanguage } from "../language-provider";
import { Action, EntryItem, ErrorLine, Field, fieldStyle, labels, panel, plannerApi, usePlanner, wrap } from "./shared";

export default function RecordsTab() {
  const { t } = useLanguage();
  const { data, open } = usePlanner();
  const [kind, setKind] = useState("");
  const [project, setProject] = useState("");
  const [skill, setSkill] = useState("");
  const [resume, setResume] = useState(false);
  const [items, setItems] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    const query = new URLSearchParams();
    if (kind) query.set("kind", kind);
    if (project) query.set("project", project);
    if (skill.trim()) query.set("skill", skill.trim());
    if (resume) query.set("resume", "1");
    const timer = setTimeout(() => void plannerApi<Entry[]>(`entries?${query}`).then(rows => {
      if (active) { setItems(rows); setError(""); }
    }).catch(err => { if (active) setError(err.message); }), 160);
    return () => { active = false; clearTimeout(timer); };
  }, [kind, project, skill, resume, data]);
  async function exportMarkdown() {
    setError(""); setCopied(false);
    try {
      const rows = items.filter(entry => entry.resume_candidate);
      const text = rows.map(entry => {
        const project = data.state.projects.find(row => row.id === entry.project_id);
        const metric = entry.metric ? ` · ${entry.metric.name} ${entry.metric.before === undefined ? "" : entry.metric.before + " → "}${entry.metric.after} ${entry.metric.unit}` : "";
        return `- ${project ? `**${project.title}** · ` : ""}${entry.body.replace(/\r?\n/g, " ")}${metric}${entry.links.length ? " · " + entry.links.join(" · ") : ""}`;
      }).join("\n");
      await navigator.clipboard.writeText(text); setCopied(true);
    } catch { setError("无法复制到剪贴板"); }
  }
  return <div className="space-y-4">
    <section className={`${panel} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{t("记录")}</h2>
        <Action primary onClick={() => open({ kind: "entries" })}>{t("新增记录")}</Action></div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("记录类型")}><select className={fieldStyle} value={kind} onChange={event => setKind(event.target.value)}>
          <option value="">{t("全部类型")}</option>{plannerEntryKinds.map(key => <option key={key} value={key}>{t(labels[key])}</option>)}</select></Field>
        <Field label={t("项目")}><select className={fieldStyle} value={project} onChange={event => setProject(event.target.value)}>
          <option value="">{t("全部项目")}</option>{data.state.projects.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></Field>
        <Field label={t("技能")}><input className={fieldStyle} value={skill} onChange={event => setSkill(event.target.value)} /></Field>
      </div>
      <div className={wrap}><label className={wrap}><input type="checkbox" checked={resume} onChange={event => setResume(event.target.checked)} />{t("仅简历候选")}</label>
        <Action onClick={() => void exportMarkdown()} disabled={!items.some(entry => entry.resume_candidate)}>{t("复制简历候选为 Markdown")}</Action>
        {copied && <span role="status" className="text-sm text-radar-muted">{t("已复制")}</span>}</div>
      <ErrorLine error={error} />
    </section>
    {items.length ? <div className="space-y-2">{items.map(entry => <EntryItem key={entry.id} entry={entry} />)}</div> :
      <p className={`${panel} text-sm text-radar-muted`}>{t("没有匹配的记录")}</p>}
  </div>;
}
