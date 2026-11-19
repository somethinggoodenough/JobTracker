import { useEffect, useMemo, useState } from "react";
import { OUTCOMES, OUTCOME_STYLE } from "@/lib/application-analytics-view";
import type { AnalyticsItem } from "@/lib/application-analytics";
import { useLanguage } from "../language-provider";
import { ApplicationPreview, ChartCard, DataTable, EmptyChart, applicationLabel, formatPercent } from "./shared";

const plottedOutcomes = OUTCOMES.filter(outcome => outcome !== "withdrawn");
const ticks = [0, 0.3, 0.6, 1];
const left = 78;
const right = 20;

function pointsByOutcome(items: readonly AnalyticsItem[], plotWidth: number) {
  let top = 12;
  return plottedOutcomes.map(outcome => {
    const row = items.filter(item => item.outcome === outcome && item.coverage !== null)
      .sort((a, b) => a.coverage! - b.coverage! || a.id - b.id);
    const lanes: number[] = [];
    const points = row.map(item => {
      const x = left + item.coverage! * plotWidth;
      let lane = lanes.findIndex(last => x - last >= 11);
      if (lane === -1) lane = lanes.length;
      lanes[lane] = x;
      return { item, x, y: top + 13 + lane * 11 };
    });
    const height = Math.max(36, lanes.length * 11 + 16);
    const result = { outcome, y: top + height / 2, bottom: top + height, points };
    top += height;
    return result;
  });
}

export default function CoverageChart({ items, active, selected, onOpen }: {
  items: readonly AnalyticsItem[]; active: ReadonlySet<number> | null; selected?: number; onOpen: (id: number) => void;
}) {
  const { t, locale } = useLanguage();
  const title = t("匹配度 × 结果");
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(300);
  const [preview, setPreview] = useState<AnalyticsItem | null>(null);
  const unplotted = items.filter(item => item.coverage === null).length;
  const eligible = items.filter(item => item.outcome !== "withdrawn");
  const hasCoverage = eligible.some(item => item.coverage !== null);
  const plotWidth = width - left - right;
  const rows = useMemo(() => pointsByOutcome(items, plotWidth), [items, plotWidth]);
  const bottom = rows[rows.length - 1].bottom;
  useEffect(() => {
    if (!element) return;
    const update = () => setWidth(Math.max(240, Math.floor(element.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  const chart = hasCoverage ? <div ref={setElement} className="relative min-w-0">
    <ApplicationPreview item={preview} />
    <svg className="block h-auto w-full overflow-visible text-[11px] text-radar-muted" viewBox={"0 0 " + width + " " + (bottom + 42)} role="group" aria-label={title}>
      {ticks.map(value => {
        const x = left + value * plotWidth;
        return <g key={value} aria-hidden="true">
          <line x1={x} x2={x} y1={12} y2={bottom} stroke="var(--color-radar-line)" strokeDasharray={value > 0 && value < 1 ? "4 4" : undefined} />
          <text x={x} y={bottom + 16} textAnchor="middle" fill="currentColor">{formatPercent(value, locale)}</text>
        </g>;
      })}
      {rows.map(row => <g key={row.outcome}>
        <line x1={left} x2={width - right} y1={row.bottom} y2={row.bottom} stroke="var(--color-radar-rule)" aria-hidden="true" />
        <text x={left - 9} y={row.y} dominantBaseline="central" textAnchor="end" fill="currentColor">{t(OUTCOME_STYLE[row.outcome].label)}</text>
        {row.points.map(({ item, x, y }) => {
          const { color, outline } = OUTCOME_STYLE[item.outcome];
          return <g key={item.id} tabIndex={0} role="button" aria-label={applicationLabel(item, locale, t)} aria-pressed={selected === item.id}
            opacity={active && !active.has(item.id) ? 0.25 : 1} className="group cursor-pointer outline-none"
            onFocus={() => setPreview(item)} onBlur={() => setPreview(null)}
            onPointerEnter={() => setPreview(item)} onPointerLeave={() => setPreview(null)}
            onClick={() => onOpen(item.id)} onKeyDown={event => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault(); onOpen(item.id);
            }}>
            <circle cx={x} cy={y} r={6} fill="white" stroke={selected === item.id ? "var(--color-radar-muted)" : "none"}
              className="group-focus-visible:[stroke:var(--color-radar-muted)]" />
            <circle cx={x} cy={y} r={4} fill={outline === "none" ? color : "white"} stroke={outline === "none" ? "none" : color}
              strokeDasharray={outline === "dashed" ? "2 1" : undefined} />
          </g>;
        })}
      </g>)}
      <text x={left + plotWidth / 2} y={bottom + 35} textAnchor="middle" fill="currentColor">{t("JD 技能覆盖率")}</text>
    </svg>
  </div> : <EmptyChart>{t("选择简历并有 JD 技术栈的申请会显示在这里。")}</EmptyChart>;

  const table = <DataTable label={title} columns={[t("公司"), t("职位"), t("状态"), t("JD 技能覆盖率"), t("已匹配技能"), t("缺少技能")]}>
    {eligible.map(item => <tr key={item.id} className={active && !active.has(item.id) ? "opacity-25" : undefined}>
      <td>{item.company}</td>
      <td><button type="button" className="text-left font-medium underline" aria-label={applicationLabel(item, locale, t)} onClick={() => onOpen(item.id)}>{item.title}</button></td>
      <td>{t(OUTCOME_STYLE[item.outcome].label)}{item.rejectedAfterProgress && <p>{t("推进后被拒")}</p>}</td>
      <td>{formatPercent(item.coverage, locale)}</td><td>{item.matchedSkills.join(", ") || "—"}</td><td>{item.missingSkills.join(", ") || "—"}</td>
    </tr>)}
  </DataTable>;
  return <ChartCard title={title} description={t("每个点代表一条申请。点选可查看申请资料与进度。")}
    chart={<>{chart}<p className="mt-3 text-xs text-radar-muted">{t("{0} 条申请缺少简历或 JD 技术栈，未显示。", unplotted)}</p></>}
    table={eligible.length ? table : <EmptyChart>{t("当前没有可显示的申请。")}</EmptyChart>} />;
}
