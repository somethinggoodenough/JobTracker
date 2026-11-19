import { useState } from "react";
import { DIMENSIONS, OUTCOMES, OUTCOME_STYLE, groupRows, outcomeCounts, type Dimension } from "@/lib/application-analytics-view";
import type { AnalyticsItem } from "@/lib/application-analytics";
import { useLanguage } from "../language-provider";
import { ApplicationPreview, ChartCard, DataTable, applicationLabel, outcomeMark } from "./shared";

type Group = ReturnType<typeof groupRows>[number];

export default function GroupComparison({ rows, dimension, onDimension, active, selectedGroup, selectedApplication, onGroup, onApplication }: {
  rows: Group[]; dimension: Dimension; onDimension: (dimension: Dimension) => void;
  active: ReadonlySet<number> | null; selectedGroup?: string; selectedApplication?: number;
  onGroup: (key: string) => void; onApplication: (id: number) => void;
}) {
  const { t, locale } = useLanguage();
  const [preview, setPreview] = useState<AnalyticsItem | null>(null);
  const title = t("分组对比");
  const label = (group: Group) => dimension === "resume" && group.key ? group.label : t(group.label);
  const dimensions = <div role="group" aria-label={t("分组维度")} className="mb-3 flex flex-wrap gap-1.5">
    {(Object.keys(DIMENSIONS) as Dimension[]).map(key => <button key={key} type="button" aria-pressed={dimension === key}
      className="rounded-lg border border-radar-line px-2.5 py-1.5 text-xs text-radar-muted hover:bg-radar-soft aria-pressed:border-radar-blue aria-pressed:bg-radar-blue aria-pressed:text-white"
      onClick={() => { setPreview(null); onDimension(key); }}>{t(DIMENSIONS[key])}</button>)}
  </div>;
  const groupButton = (group: Group) => <button type="button" aria-pressed={selectedGroup === group.key} onClick={() => onGroup(group.key)}
    className="min-w-0 break-words text-left text-xs font-medium text-radar-strong decoration-radar-focus underline-offset-2 hover:underline aria-pressed:underline [overflow-wrap:anywhere]">{label(group)}</button>;
  const ratio = (group: Group) => <div className={"whitespace-nowrap text-right text-xs tabular-nums " + (group.mature < 5 ? "text-radar-muted" : "font-semibold text-radar-strong")}>
    <span aria-label={t("{0}/{1} 有回复", group.replied, group.mature)}>{group.replied}/{group.mature}</span>
    {group.mature < 5 && <span className="block text-[10px]">{t("样本少")}</span>}
  </div>;
  const chart = <div className="relative">
    <ApplicationPreview item={preview} />
    <p className="mb-1 text-right text-xs text-radar-muted">{t("有回复 / 已成熟")}</p>
    <ul>
      {rows.map(group => <li key={group.key}
        className={"grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] items-center gap-2 border-t border-radar-rule py-2.5 " + (selectedGroup === group.key ? "bg-radar-soft/50" : "")}>
        {groupButton(group)}
        <div className="flex min-w-0 flex-wrap items-center gap-0.5">
          {group.items.map(item => <button type="button" key={item.id} aria-label={applicationLabel(item, locale, t)}
            aria-pressed={selectedApplication === item.id}
            className="size-2.5 shrink-0 rounded-[2px] focus-visible:ring-2 focus-visible:ring-radar-strong focus-visible:ring-offset-1"
            style={{ ...outcomeMark(item.outcome), opacity: active && !active.has(item.id) ? 0.25 : 1 }}
            onPointerEnter={() => setPreview(item)} onPointerLeave={() => setPreview(null)}
            onFocus={() => setPreview(item)} onBlur={() => setPreview(null)} onClick={() => onApplication(item.id)} />)}
        </div>
        {ratio(group)}
      </li>)}
    </ul>
  </div>;
  const table = <DataTable label={title} columns={[t(DIMENSIONS[dimension]), ...OUTCOMES.map(key => t(OUTCOME_STYLE[key].label)), t("有回复 / 已成熟")]}>
    {rows.map(group => {
      const counts = outcomeCounts(group.items);
      return <tr key={group.key} className={active && !group.items.some(item => active.has(item.id)) ? "opacity-25" : undefined}>
        <td>{groupButton(group)}</td>{OUTCOMES.map(key => <td key={key}>{counts[key]}</td>)}<td>{ratio(group)}</td>
      </tr>;
    })}
  </DataTable>;
  return <ChartCard title={title} description={t("每格代表一条申请。点击组名或方块联动筛选。")} chart={<>{dimensions}{chart}</>} table={<>{dimensions}{table}</>} />;
}
