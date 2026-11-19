"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { ApplicationAnalytics } from "@/lib/application-analytics";
import { DIMENSIONS, groupRows, linkedItems, timeRange, type Dimension, type LinkedFilter } from "@/lib/application-analytics-view";
import { useLanguage } from "./language-provider";
import KpiRow from "./application-analytics/kpi-row";
import WeeklyChart from "./application-analytics/weekly-chart";
import FunnelChart from "./application-analytics/funnel-chart";
import CoverageChart from "./application-analytics/coverage-chart";
import SkillGapChart from "./application-analytics/skill-gap-chart";
import GroupComparison from "./application-analytics/group-comparison";
import { EmptyChart, OutcomeLegend } from "./application-analytics/shared";

const dimensionStorageKey = "application-analytics-dimension";
const rangeLabels = { all: "全部", "30": "近 30 天", "90": "近 90 天" } as const;
type Range = keyof typeof rangeLabels;
const ranges: Range[] = ["all", "30", "90"];

export default function ApplicationAnalyticsPanel({ refreshKey, onOpen }: { refreshKey: number; onOpen: (id: number) => void }) {
  const { t } = useLanguage();
  const [data, setData] = useState<ApplicationAnalytics | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [range, setRange] = useState<Range>("all");
  const [dimension, setDimension] = useState<Dimension>("resume");
  const [filter, setFilter] = useState<LinkedFilter | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(dimensionStorageKey);
      if (saved && Object.hasOwn(DIMENSIONS, saved)) setDimension(saved as Dimension);
    } catch { /* Use the default dimension when storage is unavailable. */ }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/applications/analytics", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("读取申请统计失败");
        const result = await response.json() as ApplicationAnalytics;
        if (!controller.signal.aborted) { setData(result); setError(false); }
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    }
    void load();
    return () => controller.abort();
  }, [refreshKey, retry]);

  function chooseDimension(next: Dimension) {
    setDimension(next);
    try { localStorage.setItem(dimensionStorageKey, next); } catch { /* Selection remains active on this page. */ }
  }

  function select(next: LinkedFilter) {
    setFilter(current => JSON.stringify(current) === JSON.stringify(next) ? null : next);
  }

  const now = useMemo(() => new Date(data?.generatedAt ?? 0), [data]);
  const items = useMemo(() => timeRange(data?.items ?? [], range, now), [data, range, now]);
  const rows = useMemo(() => groupRows(items, dimension), [items, dimension]);
  const selected = useMemo(() => filter ? linkedItems(items, filter) : items, [items, filter]);
  const active = useMemo(() => filter ? new Set(selected.map(item => item.id)) : null, [filter, selected]);
  const filterLabel = (() => {
    if (!filter || !data) return "";
    if (filter.kind === "skill") return filter.skill;
    if (filter.kind === "application") {
      const item = data.items.find(item => item.id === filter.id);
      return item ? item.company + " · " + item.title : t("申请记录");
    }
    const group = (filter.dimension === dimension ? rows : groupRows(items, filter.dimension))
      .find(group => group.key === filter.key) ?? groupRows(data.items, filter.dimension).find(group => group.key === filter.key);
    return group ? (filter.dimension === "resume" && group.key ? group.label : t(group.label)) : t(DIMENSIONS[filter.dimension]);
  })();

  return <section aria-label={t("申请数据分析")} className="mt-6 min-w-0 space-y-4">
    {error && <div className="flex flex-wrap items-center gap-3 rounded-xl bg-red-50 p-4 text-sm text-red-700" role="alert">
      {t("读取申请统计失败")}<button type="button" className="icon-button" onClick={() => { setError(false); setRetry(value => value + 1); }}>{t("重试")}</button>
    </div>}
    {!data && !error && <p role="status" className="text-sm text-radar-muted">{t("正在统计申请进度…")}</p>}
    {data && <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-radar-line bg-white px-4 py-3">
        <div role="group" aria-label={t("时间范围")} className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-radar-muted">{t("时间范围")}</span>
          {ranges.map(key => <button type="button" key={key} aria-pressed={range === key} onClick={() => setRange(key)}
            className="rounded-lg border border-radar-line px-2.5 py-1.5 text-xs text-radar-muted hover:bg-radar-soft aria-pressed:border-radar-blue aria-pressed:bg-radar-blue aria-pressed:text-white">{t(rangeLabels[key])}</button>)}
        </div>
        {filter && <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-radar-muted">
          <span aria-live="polite" className="break-words [overflow-wrap:anywhere]">{t("联动筛选：{0} · {1} 条", filterLabel, selected.length)}</span>
          <button type="button" className="icon-button !py-1.5 !text-xs" onClick={() => setFilter(null)}>{t("清除联动筛选")}<X size={14} aria-hidden="true" /></button>
        </div>}
      </div>
      <KpiRow items={selected} tracked={data.tracked} filtered={!!filter} />
      {!items.length ? <EmptyChart>{data.items.length
        ? t("这个时间范围内没有投递记录。")
        : t("记录第一份投递后，这里会显示按简历、国家、岗位和技术栈的统计。")}</EmptyChart> : <>
        <OutcomeLegend ghostDays={data.ghostDays} />
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <WeeklyChart items={items} now={now} active={active} />
          <FunnelChart items={items} active={active} />
        </div>
        <CoverageChart items={items} active={active} selected={filter?.kind === "application" ? filter.id : undefined}
          onOpen={id => { select({ kind: "application", id }); onOpen(id); }} />
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
          <SkillGapChart items={items} active={active} selected={filter?.kind === "skill" ? filter.skill : undefined} onSelect={skill => select({ kind: "skill", skill })} />
          <GroupComparison rows={rows} dimension={dimension} onDimension={chooseDimension} active={active}
            selectedGroup={filter?.kind === "group" && filter.dimension === dimension ? filter.key : undefined}
            selectedApplication={filter?.kind === "application" ? filter.id : undefined}
            onGroup={key => select({ kind: "group", dimension, key })} onApplication={id => select({ kind: "application", id })} />
        </div>
      </>}
    </>}
  </section>;
}
