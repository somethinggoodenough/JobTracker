import { Bar, BarChart, CartesianGrid, Rectangle, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { OUTCOMES, OUTCOME_STYLE, outcomeCounts, weekly } from "@/lib/application-analytics-view";
import type { AnalyticsItem, AnalyticsOutcome } from "@/lib/application-analytics";
import { useLanguage } from "../language-provider";
import { ChartCard, DataTable, EmptyChart, outcomeMark } from "./shared";

type Week = ReturnType<typeof weekly>[number];
type StackSegment = { x?: number; y?: number; width?: number; height?: number; payload?: Week & { selected: Week["counts"] } };

function segment(outcome: AnalyticsOutcome, props: StackSegment) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  const full = payload?.counts[outcome] ?? 0;
  if (!full || height <= 0 || width <= 0) return <g />;
  const { outline, color } = OUTCOME_STYLE[outcome];
  const bodyHeight = Math.max(height - 2, 0.5);
  const visibleFrom = bodyHeight * (payload?.selected[outcome] ?? 0) / full;
  const shape = { x, width, fill: outline === "none" ? color : "none",
    stroke: outline === "none" ? "none" : color, strokeDasharray: outline === "dashed" ? "3 2" : undefined, radius: 2 };
  return <g>
    {visibleFrom < bodyHeight && <Rectangle {...shape} y={y + 1} height={bodyHeight - visibleFrom} opacity={0.25} />}
    {visibleFrom > 0 && <Rectangle {...shape} y={y + 1 + bodyHeight - visibleFrom} height={visibleFrom} />}
  </g>;
}

export default function WeeklyChart({ items, now, active }: {
  items: readonly AnalyticsItem[]; now: Date; active: ReadonlySet<number> | null;
}) {
  const { locale, t } = useLanguage();
  const title = t("每周投递节奏");
  const weeks = weekly(items, now).map(week => ({
    ...week, ...week.counts, selected: active ? outcomeCounts(week.items.filter(item => active.has(item.id))) : week.counts,
  }));
  const short = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", timeZone: "UTC" });
  const long = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const hasWeeks = weeks.some(week => week.items.length);
  const chart = hasWeeks ? <ChartContainer config={{}} className="mt-4 h-[248px] w-full !aspect-auto">
    <BarChart data={weeks} margin={{ left: -11, right: 6, top: 10, bottom: 0 }} accessibilityLayer>
      <CartesianGrid vertical={false} stroke="var(--color-radar-rule)" />
      <XAxis dataKey="week" tickFormatter={value => short.format(new Date(value))} tickLine={false} axisLine={false} minTickGap={12} />
      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={35} />
      <ChartTooltip cursor={{ fill: "var(--color-radar-rule)", opacity: 0.6 }} content={({ active: hovered, label }) => {
        const week = hovered ? weeks.find(row => row.week === label) : undefined;
        return week ? <div className="min-w-36 rounded-lg border border-radar-line bg-white px-3 py-2 text-xs leading-5 text-radar-muted shadow-md">
          <p className="font-semibold">{t("{0} 当周", long.format(new Date(week.week)))}</p>
          {OUTCOMES.map(outcome => <div className="flex items-center gap-2" key={outcome}>
            <span className="size-2.5 rounded-[2px]" style={outcomeMark(outcome)} />
            <span className="flex-1">{t(OUTCOME_STYLE[outcome].label)}</span>
            <span className="tabular-nums">{week.counts[outcome]}</span>
          </div>)}
        </div> : null;
      }} />
      {OUTCOMES.map(outcome => <Bar key={outcome} stackId="week" dataKey={outcome} maxBarSize={31} isAnimationActive={false}
        name={t(OUTCOME_STYLE[outcome].label)} fill={OUTCOME_STYLE[outcome].color}
        shape={(props: StackSegment) => segment(outcome, props)} />)}
    </BarChart>
  </ChartContainer> : <EmptyChart>{t("最近 12 周没有符合时间范围的投递。")}</EmptyChart>;
  const table = <DataTable label={title} columns={[t("周起始日期"), t("申请数"), ...OUTCOMES.map(outcome => t(OUTCOME_STYLE[outcome].label)), ...(active ? [t("筛选命中")] : [])]}>
    {weeks.map(week => <tr key={week.week}>
      <td className="whitespace-nowrap">{long.format(new Date(week.week))}</td><td>{week.items.length}</td>
      {OUTCOMES.map(outcome => <td key={outcome}>{week.counts[outcome]}</td>)}
      {active && <td>{week.items.filter(item => active.has(item.id)).length}</td>}
    </tr>)}
  </DataTable>;
  return <ChartCard title={title} description={t("最近 12 周 · 每周一开始（纽约时间）")} chart={chart} table={table} />;
}
