import { useId } from "react";
import { OUTCOME_STYLE, responseCounts, skillGaps } from "@/lib/application-analytics-view";
import type { AnalyticsItem } from "@/lib/application-analytics";
import { useLanguage } from "../language-provider";
import { ChartCard, DataTable, EmptyChart } from "./shared";

export default function SkillGapChart({ items, active, selected, onSelect }: {
  items: readonly AnalyticsItem[]; active: ReadonlySet<number> | null; selected?: string; onSelect: (skill: string) => void;
}) {
  const { t } = useLanguage();
  const title = t("技能缺口");
  const tooltipPrefix = useId();
  const rows = skillGaps(items);
  const max = rows[0]?.total ?? 1;
  const includedColor = OUTCOME_STYLE.ghosted.color;
  const missingColor = OUTCOME_STYLE.rejected.color;
  function section(group: AnalyticsItem[], color: string) {
    const highlighted = active ? group.filter(item => active.has(item.id)).length : group.length;
    return <span className="flex h-full" style={{ width: (group.length / max * 100) + "%" }}>
      <span style={{ backgroundColor: color, flex: highlighted }} />
      <span className="opacity-25" style={{ backgroundColor: color, flex: group.length - highlighted }} />
    </span>;
  }

  const chart = rows.length ? <>
    <div className="mb-3 flex flex-wrap gap-3 text-xs text-radar-muted">
      {[[t("简历写了"), includedColor], [t("简历没写"), missingColor]].map(([label, color]) => <span className="inline-flex items-center gap-1.5" key={label}>
        <span className="size-2.5 rounded-[2px]" style={{ backgroundColor: color }} aria-hidden="true" />{label}
      </span>)}
    </div>
    <ul className="space-y-1.5">
      {rows.map(({ skill, total, included, missing }, index) => {
        const have = responseCounts(included), lack = responseCounts(missing);
        const id = tooltipPrefix + index;
        return <li key={skill} className="group relative">
          <button type="button" aria-pressed={selected === skill} aria-describedby={id} onClick={() => onSelect(skill)}
            className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_auto] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-radar-muted hover:bg-radar-soft aria-pressed:bg-radar-soft">
            <span className="break-words font-medium [overflow-wrap:anywhere]">{skill}</span>
            <span className="flex h-2.5 overflow-hidden rounded-full bg-radar-rule" aria-hidden="true">{section(included, includedColor)}{section(missing, missingColor)}</span>
            <strong className="min-w-5 text-right tabular-nums">{total}</strong>
          </button>
          <span role="tooltip" id={id} className="pointer-events-none absolute right-0 bottom-full z-10 hidden max-w-full rounded-lg border border-radar-line bg-white px-3 py-2 text-xs text-radar-muted shadow-md group-hover:block group-focus-within:block">
            {t("简历写了：{0}/{1} 有回复；没写：{2}/{3} 有回复", have.replied, have.mature, lack.replied, lack.mature)}
          </span>
        </li>;
      })}
    </ul>
  </> : <EmptyChart>{t("这里会显示 JD 中已提取的技能。")}</EmptyChart>;

  const table = <DataTable label={title} columns={[t("技能"), t("总次数"), t("简历写了"), t("简历没写"), t("写了：有回复/已成熟"), t("没写：有回复/已成熟")]}>
    {rows.map(({ skill, total, included, missing }) => {
      const have = responseCounts(included), lack = responseCounts(missing);
      return <tr key={skill} className={active && ![...included, ...missing].some(item => active.has(item.id)) ? "opacity-25" : undefined}>
        <td><button type="button" className="font-medium underline" aria-pressed={selected === skill} onClick={() => onSelect(skill)}>{skill}</button></td>
        <td>{total}</td><td>{included.length}</td><td>{missing.length}</td><td>{have.replied}/{have.mature}</td><td>{lack.replied}/{lack.mature}</td>
      </tr>;
    })}
  </DataTable>;
  return <ChartCard title={title} description={t("JD 出现最多的 15 项技能；未选择简历的申请计入「简历没写」。")} chart={chart} table={rows.length ? table : chart} />;
}
