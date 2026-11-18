import { careerLevels, jobCategories, type JobAnalysis } from "@/lib/classification-types";

export function ClassificationTags({ analysis }: { analysis: JobAnalysis | null | undefined }) {
  if (!analysis) return null;
  return <div className="mt-3 flex flex-wrap gap-2" aria-label="AI 岗位分类">
    {analysis.categories.map(category => <span key={category} className="tag !border-[#bfd2b6] !bg-[#edf5e6] !text-[#315a32]">{jobCategories[category]}</span>)}
    <span className="tag !bg-[#e9eefb] !text-[#405781]">{careerLevels[analysis.careerLevel]}</span>
    {analysis.countries.map(country => <span className="tag" key={country}>{country === "US" ? "美国" : "中国"}</span>)}
    {analysis.countries.includes("US") && analysis.usSponsorship?.available && <span aria-label="美国签证赞助" title={analysis.usSponsorship.evidence} className="tag !border-[#a8cdb8] !bg-[#e0f4e9] !font-semibold !text-[#1e6847]">US Sponsorship · 明确提供签证赞助</span>}
  </div>;
}

export function JobAnalysisPanel({ analysis }: { analysis: JobAnalysis | null | undefined }) {
  if (!analysis) return null;
  return <section className="my-6 rounded-2xl border border-[#ccdac2] bg-[#f0f5e9] p-5" aria-label="JD 技术栈与筛选依据">
    <h3 className="font-semibold text-[#2f5135]">JD 技术栈</h3>
    <p className="mt-2 text-xs text-[#71816a]">DeepSeek 从原文提取，包含必需或优先考虑的技术；具体要求请查看下方引文。</p>
    {analysis.techStack.length ? <ul className="mt-4 space-y-3">{analysis.techStack.map((tech, index) => <li key={`${tech.name}-${index}`} className="text-sm"><strong className="font-medium text-[#315a32]">{tech.name}</strong><p className="mt-1 break-words text-xs leading-5 text-[#697563]">“{tech.evidence}”</p></li>)}</ul> : <p className="mt-4 text-sm text-[#697563]">JD 未明确列出具体技术，未推测补充。</p>}
    {analysis.countries.includes("US") && analysis.usSponsorship?.available && <div aria-label="美国签证赞助原文" className="mt-5 rounded-xl border border-[#a8cdb8] bg-[#e0f4e9] p-4"><h4 className="text-sm font-semibold text-[#1e6847]">美国岗位 · 明确提供签证赞助</h4><p className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-[#426553]">“{analysis.usSponsorship.evidence}”</p></div>}
    <details className="mt-5 border-t border-[#d7e1cf] pt-4 text-xs leading-6 text-[#697563]"><summary className="cursor-pointer font-medium">查看分类与录用级别判断依据</summary><p className="mt-2">{analysis.reason}</p><p>岗位：“{analysis.roleEvidence}”</p><p>级别：“{analysis.levelEvidence}”</p><p>地点：“{analysis.locationEvidence}”</p></details>
  </section>;
}
