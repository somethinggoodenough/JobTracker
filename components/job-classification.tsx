import { careerLevels, jobCategories, type JobAnalysis } from "@/lib/classification-types";
import { useLanguage } from "@/app/language-provider";

const sponsorshipLabels = {
  available: { text: "明确提供", style: "!border-[#a8cdb8] !bg-[#e0f4e9] !text-[#1e6847]" },
  unavailable: { text: "明确不提供", style: "!border-[#e2c5bb] !bg-[#fff0ec] !text-[#873b2f]" },
  unclear: { text: "未确认", style: "!border-[#dfd4b9] !bg-[#fcf6e8] !text-[#6b572c]" },
};

export function ClassificationTags({ analysis }: { analysis: JobAnalysis | null | undefined }) {
  const { t } = useLanguage();
  if (!analysis) return null;
  const visa = analysis.visaSponsorship;
  return <div className="mt-3 flex flex-wrap gap-2" aria-label={t("AI 岗位分类")}>
    {analysis.categories.map(category => <span key={category} className="tag !border-[#bfd2b6] !bg-[#edf5e6] !text-[#315a32]">{jobCategories[category]}</span>)}
    <span className="tag !bg-[#e9eefb] !text-[#405781]">{t(careerLevels[analysis.careerLevel])}</span>
    {analysis.countries.map(country => <span className="tag" key={country}>{country === "US" ? t("美国") : t("中国")}</span>)}
    {visa && <span aria-label={t("美国签证赞助 {0}", t(sponsorshipLabels[visa.status].text))} className={`tag !font-semibold ${sponsorshipLabels[visa.status].style}`}>{t("美国签证赞助 ·")} {t(sponsorshipLabels[visa.status].text)}</span>}
  </div>;
}

export function JobAnalysisPanel({ analysis }: { analysis: JobAnalysis | null | undefined }) {
  const { t } = useLanguage();
  if (!analysis) return null;
  const visa = analysis.visaSponsorship;
  return <section className="my-6 rounded-2xl border border-[#ccdac2] bg-[#f0f5e9] p-5" aria-label={t("JD 技术栈与筛选依据")}>
    <h3 className="font-semibold text-[#2f5135]">{t("JD 技术栈")}</h3>
    <p className="mt-2 text-xs text-[#71816a]">{t("DeepSeek 从原文提取，包含必需或优先考虑的技术；具体要求请查看下方引文。")}</p>
    {analysis.techStack.length ? <ul className="mt-4 space-y-3">{analysis.techStack.map((tech, index) => <li key={`${tech.name}-${index}`} className="text-sm"><strong className="font-medium text-[#315a32]">{tech.name}</strong><p className="mt-1 break-words text-xs leading-5 text-[#697563]">“{tech.evidence}”</p></li>)}</ul> : <p className="mt-4 text-sm text-[#697563]">{t("JD 未明确列出具体技术，未推测补充。")}</p>}
    {visa && <div aria-label={t("美国签证赞助详情")} className={`mt-5 rounded-xl border p-4 ${sponsorshipLabels[visa.status].style}`}>
      <h4 className="text-sm font-semibold">{t("美国签证赞助 ·")} {t(sponsorshipLabels[visa.status].text)}</h4>
      {visa.evidence ? <p aria-label={t("美国签证赞助原文")} className="mt-2 whitespace-pre-wrap break-words text-xs leading-6">“{visa.evidence}”</p>
        : <p className="mt-2 text-xs leading-6">{t("JD 未找到明确说明，投递前可向招聘方确认。")}</p>}
    </div>}
    <details className="mt-5 border-t border-[#d7e1cf] pt-4 text-xs leading-6 text-[#697563]"><summary className="cursor-pointer font-medium">{t("查看分类与录用级别判断依据")}</summary><p className="mt-2">{analysis.reason}</p><p>{t("岗位：“{0}”", analysis.roleEvidence)}</p><p>{t("级别：“{0}”", analysis.levelEvidence)}</p><p>{t("地点：“{0}”", analysis.locationEvidence)}</p></details>
  </section>;
}
