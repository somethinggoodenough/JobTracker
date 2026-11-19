import { useLanguage } from "../language-provider";
import { funnel, kpis } from "@/lib/application-analytics-view";
import type { AnalyticsItem } from "@/lib/application-analytics";
import { ChartCard, DataTable } from "./shared";

export default function FunnelChart({ items, active }: { items: readonly AnalyticsItem[]; active: ReadonlySet<number> | null }) {
  const { t } = useLanguage();
  const rows = funnel(items);
  const highlighted = active ? funnel(items.filter(item => active.has(item.id))) : rows;
  const { waiting } = kpis(items);
  const title = t("申请漏斗");
  const chart = <ol className="space-y-1.5">
    {rows.map(({ label, amount, color }, index) => <li key={label}>
      {index > 0 && <p className="mb-1 text-xs tabular-nums text-radar-muted" aria-label={t("减少 {0} 条", rows[index - 1].amount - amount)}>
        ↓ {rows[index - 1].amount - amount}
      </p>}
      <div className="flex justify-between gap-3 text-sm text-radar-muted">
        <span>{t(label)}</span><strong className="tabular-nums text-radar-ink">{amount}</strong>
      </div>
      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-radar-tint" aria-hidden="true">
        <div className="flex h-full overflow-hidden rounded-full" style={{ width: (amount / items.length * 100) + "%" }}>
          <span style={{ backgroundColor: color, width: (amount ? highlighted[index].amount / amount * 100 : 0) + "%" }} />
          <span className="flex-1 opacity-25" style={{ backgroundColor: color }} />
        </div>
      </div>
      {index === 0 && <p className="mt-1 text-xs text-radar-muted">{t("其中 {0} 条仍在等待", waiting)}</p>}
    </li>)}
  </ol>;
  const table = <DataTable label={title} columns={[t("阶段"), t("申请数"), t("较上一阶段减少"), ...(active ? [t("筛选命中")] : [])]}>
    {rows.map(({ label, amount }, index) => <tr key={label}>
      <td>{t(label)}{index === 0 && <p>{t("其中 {0} 条仍在等待", waiting)}</p>}</td>
      <td>{amount}</td><td>{index ? rows[index - 1].amount - amount : "—"}</td>{active && <td>{highlighted[index].amount}</td>}
    </tr>)}
  </DataTable>;
  return <ChartCard title={title} description={t("每一阶段以全部投递为基准。")} chart={chart} table={table} />;
}
