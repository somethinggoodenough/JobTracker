"use client";

import { useState } from "react";
import { plannerCardResults, type Card, type CardResult } from "@/lib/planner-types";
import { useLanguage } from "../language-provider";
import { Action, cardForProject, ErrorLine, Field, fieldStyle, panel, plannerApi, usePlanner, wrap } from "./shared";

const labels: Record<CardResult, string> = { remembered: "记得", fuzzy: "模糊", forgot: "忘了" };

export default function ReviewCardsTab() {
  const { t } = useLanguage();
  const { data, reviewOnlyProject, refresh, open } = usePlanner();
  const [project, setProject] = useState<number | null>(reviewOnlyProject);
  const [revealed, setRevealed] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const due = cardForProject(data.state.cards, project, data.today);
  const card = due[0];
  async function review(item: Card, result: CardResult) {
    setError(""); setBusy(true);
    try { await plannerApi(`cards/${item.id}/review`, "POST", { result, version: item.version }); await refresh(); setRevealed(null); }
    catch (err) { setError(err instanceof Error ? err.message : "计划操作失败，请重试"); }
    finally { setBusy(false); }
  }
  return <section className={`${panel} space-y-4`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{t("复习")}</h2>
      <span className="text-sm text-radar-muted">{t("{0} 张卡片今天到期", due.length)}</span></div>
    <Field label={t("项目")}><select className={`${fieldStyle} sm:max-w-xs`} value={project ?? ""}
      onChange={event => { setProject(Number(event.target.value) || null); setRevealed(null); }}>
      <option value="">{t("全部项目")}</option>{data.state.projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
    {card ? <article className="space-y-3 rounded-xl border border-radar-line p-4">
      <h3 className="whitespace-pre-wrap break-words font-semibold">{card.question}</h3>
      {revealed === card.id ? <>
        <p className="whitespace-pre-wrap break-words text-sm">{card.answer}</p>
        <div className={wrap}>{plannerCardResults.map(result => <Action key={result} primary={result === "remembered"} disabled={busy}
          onClick={() => void review(card, result)}>{t(labels[result])}</Action>)}</div>
      </> : <Action primary onClick={() => setRevealed(card.id)}>{t("显示答案")}</Action>}
    </article> : <p className="text-sm text-radar-muted">{t("没有到期的复习卡")}</p>}
    <ErrorLine error={error} />
    {!!data.state.cards.length && <details><summary className="cursor-pointer text-sm font-semibold">{t("全部复习卡")}</summary>
      <ul className="mt-2 space-y-2">{data.state.cards.filter(row => project === null || row.project_id === project).map(row => <li key={row.id} className={wrap}>
        <span className="break-words text-sm">{row.question} · {row.due_on}</span>
        <Action onClick={() => open({ kind: "cards", row: { ...row } })}>{t("编辑")}</Action></li>)}</ul></details>}
  </section>;
}
