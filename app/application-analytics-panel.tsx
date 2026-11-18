"use client";

import { useEffect, useState } from "react";
import type { ApplicationAnalytics } from "@/lib/application-analytics";
import { useLanguage } from "./language-provider";

const dimensions = {
  resume: "简历", country: "国家", role: "岗位分类", jobStack: "JD 技术栈", resumeStack: "简历技术栈",
};
type Dimension = keyof typeof dimensions;
const rate = (outcome: number, applied: number) => applied ? `${(outcome / applied * 100).toFixed(1)}%` : "—";

export default function ApplicationAnalyticsPanel({ refreshKey }: { refreshKey: number }) {
  const { t } = useLanguage();
  const [data, setData] = useState<ApplicationAnalytics | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [dimension, setDimension] = useState<Dimension>("resume");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/applications/analytics", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("读取申请统计失败");
        const result = await response.json() as ApplicationAnalytics;
        if (!controller.signal.aborted) { setData(result); setError(""); }
      } catch {
        if (!controller.signal.aborted) setError("读取申请统计失败");
      }
    }
    void load();
    return () => controller.abort();
  }, [refreshKey, retry]);

  return <section aria-label={t("申请数据分析")} className="mt-6 min-w-0 space-y-5">
    {error && <div className="flex flex-wrap items-center gap-3 rounded-xl bg-red-50 p-4 text-sm text-red-700" role="alert">{t(error)}<button className="icon-button" onClick={() => { setError(""); setRetry(value => value + 1); }}>{t("重试")}</button></div>}
    {!data && !error && <p role="status" className="text-sm text-[#697169]">{t("正在统计申请进度…")}</p>}
    {data && <>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">{([
        [t("已投递"), data.submitted.applied, t("共跟踪 {0} 个岗位", data.tracked)],
        [t("曾进入下一步"), data.submitted.advanced, rate(data.submitted.advanced, data.submitted.applied)],
        [t("曾被拒绝"), data.submitted.rejected, rate(data.submitted.rejected, data.submitted.applied)],
        [t("待结果"), data.submitted.open, t("尚无推进或拒绝记录")],
      ] as const).map(([label, value, note]) => <div key={label} className="rounded-2xl border border-[#dfe2d8] bg-white p-4">
        <dt className="text-sm text-[#526453]">{label}</dt><dd className="mt-2 text-3xl font-semibold tabular-nums">{value}</dd>
        <dd className="mt-1 text-xs text-[#647060]">{note}</dd>
      </div>)}</dl>
      <p className="text-xs leading-6 text-[#647060]">{t("以已投递岗位为分母。筛选中、面试或收到 Offer 都算推进；先推进后被拒的岗位会同时计入两项。待结果排除已撤回的申请。仅收藏的岗位计入跟踪总数。")}</p>
      {data.submitted.applied ? <div className="rounded-2xl border border-[#dfe2d8] bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t("分组表现")}</h2>
          <label className="flex items-center gap-2 text-sm text-[#526453]">{t("分组维度")}
            <select aria-label={t("申请统计分组维度")} className="source-input" value={dimension} onChange={event => setDimension(event.target.value as Dimension)}>
              {Object.entries(dimensions).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}
            </select>
          </label>
        </div>
        <p className="my-3 text-xs leading-5 text-[#647060]">{dimension === "resume"
          ? t("同一份简历的各版本合并统计，以申请记录选择的简历为准。")
          : t("一份申请可能命中多个标签，每个对应分组各计一次。组内比率以该组投递数计算。")}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] border-collapse text-left text-sm">
            <caption className="sr-only">{t("按{0}统计申请表现", t(dimensions[dimension]))}</caption>
            <thead className="border-b border-[#dfe2d8] text-xs text-[#526453]">
              <tr>{[dimensions[dimension], t("已投递"), t("曾推进（推进率）"), t("曾被拒（拒绝率）")].map(label =>
                <th key={label} scope="col" className="px-2 py-3 first:pl-0">{t(label)}</th>)}</tr>
            </thead>
            <tbody>{data.groups[dimension].map(group => <tr key={group.key} className="border-b border-[#edf0ea] last:border-0">
              <th scope="row" className="break-words py-3 pr-3 font-medium">{!group.key || dimension === "country" ? t(group.label) : group.label}</th>
              <td className="px-2 tabular-nums">{group.applied}</td>
              <td className="whitespace-nowrap px-2 text-[#245733] tabular-nums">{t("{0}（{1}）", group.advanced, rate(group.advanced, group.applied))}</td>
              <td className="whitespace-nowrap px-2 text-[#854442] tabular-nums">{t("{0}（{1}）", group.rejected, rate(group.rejected, group.applied))}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </div> : <p className="rounded-2xl border border-dashed border-[#cbd0c7] bg-white/60 p-6 text-sm text-[#526453]">{t("记录第一份投递后，这里会显示按简历、国家、岗位和技术栈的统计。")}</p>}
    </>}
  </section>;
}
