import { useLanguage } from "../language-provider";
import { kpis } from "@/lib/application-analytics-view";
import { formatPercent } from "./shared";
import type { AnalyticsItem } from "@/lib/application-analytics";

export default function KpiRow({ items, tracked, filtered }: { items: readonly AnalyticsItem[]; tracked: number; filtered: boolean }) {
  const { t, locale } = useLanguage();
  const metrics = kpis(items);
  const cards = [
    { label: "已投递", value: metrics.submitted, note: t("共跟踪 {0} 个岗位", tracked) },
    { label: "回复率", value: metrics.replied + "/" + metrics.mature, note: t("不含 {0} 条等待中、{1} 条已撤回", metrics.waiting, metrics.withdrawn),
      rate: formatPercent(metrics.responseRate, locale) },
    { label: "面试", value: metrics.interviewed, note: t("包含进入面试或收到 Offer") },
    { label: "首次回复天数中位数", value: metrics.medianResponse === null ? "—" : t("{0} 天", new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(metrics.medianResponse)),
      note: t("按有回复时间记录的申请计算") },
  ];
  return <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {cards.map(({ label, value, note, rate }) => <div key={label} className="min-w-0 rounded-2xl border border-radar-line bg-white p-3 sm:p-4">
      <dt className="flex flex-wrap items-start justify-between gap-1.5 text-sm text-radar-muted">
        {t(label)}{filtered && <span className="rounded-full bg-radar-soft px-2 py-0.5 text-[10px] text-radar-strong">{t("已筛选")}</span>}
      </dt>
      <dd className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
        {value}{rate && <span className="text-sm font-medium tracking-normal text-radar-muted">{rate}</span>}
      </dd>
      <dd className="mt-1.5 text-xs leading-5 text-radar-muted">{note}</dd>
    </div>)}
  </dl>;
}
