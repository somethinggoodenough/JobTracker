"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { BarChart2, Table2 } from "lucide-react";
import { useLanguage } from "../language-provider";
import { OUTCOMES, OUTCOME_STYLE } from "@/lib/application-analytics-view";
import type { AnalyticsItem, AnalyticsOutcome } from "@/lib/application-analytics";
import type { Locale, Translate } from "@/lib/ui-language";

export function outcomeMark(outcome: AnalyticsOutcome): CSSProperties {
  const { color, outline } = OUTCOME_STYLE[outcome];
  return outline === "none" ? { backgroundColor: color } : { border: "1px " + outline + " " + color };
}

export function OutcomeLegend({ ghostDays }: { ghostDays: number }) {
  const { t } = useLanguage();
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-radar-line bg-white/70 px-4 py-3 text-xs text-radar-muted">
    <strong className="font-semibold">{t("结果图例")}</strong>
    {OUTCOMES.map(outcome => <span key={outcome} className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="size-2.5 rounded-[2px]" style={outcomeMark(outcome)} />
      {t(OUTCOME_STYLE[outcome].label)}
    </span>)}
    <span className="text-radar-muted">{t("{0} 天无回复计为没回音", ghostDays)}</span>
  </div>;
}

export function ChartCard({ title, description, chart, table }: {
  title: string; description?: string; chart: ReactNode; table: ReactNode;
}) {
  const { t } = useLanguage();
  const id = useId();
  const [asTable, setAsTable] = useState(false);
  return <section aria-labelledby={id} className="min-w-0 rounded-2xl border border-radar-line bg-white p-4 sm:p-5">
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <h2 id={id} className="text-lg font-semibold leading-snug">{title}</h2>
        {description && <p className="mt-1.5 text-xs leading-5 text-radar-muted">{description}</p>}
      </div>
      <button type="button" className="icon-button shrink-0 !px-2.5 !py-1.5 !text-xs" aria-pressed={asTable}
        aria-label={t("{0}：{1}", title, asTable ? t("以图表查看") : t("以表格查看"))} onClick={() => setAsTable(value => !value)}>
        {asTable ? <BarChart2 size={14} aria-hidden="true" /> : <Table2 size={14} aria-hidden="true" />}{asTable ? t("以图表查看") : t("以表格查看")}
      </button>
    </div>
    {asTable ? table : chart}
  </section>;
}

export function DataTable({ label, columns, children }: { label: string; columns: string[]; children: ReactNode }) {
  return <div className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label={label}>
    <table className="w-full border-collapse text-left text-xs text-radar-muted [&_td]:px-2 [&_td]:py-2 [&_tbody_tr]:border-t [&_tbody_tr]:border-radar-rule">
      <caption className="sr-only">{label}</caption>
      <thead><tr>{columns.map((column, index) => <th key={index} scope="col" className="whitespace-nowrap px-2 py-2">{column}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>;
}

export const formatPercent = (value: number | null, locale: Locale) => value === null ? "—" : new Intl.NumberFormat(locale, {
  style: "percent", maximumFractionDigits: 0,
}).format(value);

export function applicationLabel(item: AnalyticsItem, locale: Locale, t: Translate) {
  return t("{0} · {1} · {2} · 覆盖率 {3}", item.company, item.title, t(OUTCOME_STYLE[item.outcome].label), formatPercent(item.coverage, locale));
}

const progressRejection = { offer: "收到 Offer 后被拒", interview: "面试后被拒", screening: "筛选后被拒" } as const;
export function ApplicationPreview({ item }: { item: AnalyticsItem | null }) {
  const { t, locale } = useLanguage();
  if (!item) return null;
  return <div role="tooltip" className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-2 max-w-sm rounded-xl border border-radar-line bg-white p-3 text-xs leading-5 text-radar-muted shadow-lg sm:left-auto sm:w-80">
    <p className="break-words font-semibold text-radar-ink">{applicationLabel(item, locale, t)}</p>
    {item.rejectedAfterProgress && item.outcome in progressRejection &&
      <p>{t(progressRejection[item.outcome as keyof typeof progressRejection])}</p>}
    <p className="break-words">{t("已匹配：{0}", item.matchedSkills.join(", ") || "—")}</p>
    <p className="break-words">{t("缺少：{0}", item.missingSkills.join(", ") || "—")}</p>
  </div>;
}

export function EmptyChart({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-radar-line px-4 py-6 text-sm leading-6 text-radar-muted">{children}</p>;
}
