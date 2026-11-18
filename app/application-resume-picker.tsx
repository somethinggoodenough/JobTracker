"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, RefreshCw, Search } from "lucide-react";
import type { ApplicationResumeSnapshot } from "@/lib/application-types";
import type { ResumeSummary } from "@/lib/resume-types";

export type ResumeSelection = Omit<ApplicationResumeSnapshot, "selected_at">;
type Pages = { page: number; total: number; totalPages: number };
const keyOf = (resume: ResumeSelection) => `${resume.id}:${resume.version}`;

export default function ApplicationResumePicker({ value, onChange }: { value: ResumeSelection | null; onChange: (resume: ResumeSelection | null) => void }) {
  const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const [rows, setRows] = useState<ResumeSummary[]>([]), [pages, setPages] = useState<Pages>({ page: 1, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => { const timer = setTimeout(() => { setSearch(query); setPage(1); }, 250); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    (async () => {
      try {
        const response = await fetch(`/api/resumes?${new URLSearchParams({ q: search, page: String(page) })}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json() as { resumes: ResumeSummary[]; pagination: Pages; error?: string };
        if (!response.ok) throw new Error(data.error || "简历列表读取失败");
        if (controller.signal.aborted) return;
        setRows(data.resumes); setPages(data.pagination);
        if (data.pagination.page !== page) setPage(data.pagination.page);
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "简历列表读取失败"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [search, page, refresh]);
  const selectedKey = value ? keyOf(value) : "", found = value && rows.some(row => keyOf(row) === selectedKey);
  return <section aria-label="从简历库选择" className="min-w-0 rounded-2xl border border-[#d8ddd2] bg-[#f0f4e9] p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">申请使用的简历</h3><a href="/resumes" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[#456d38]">管理简历 <ArrowUpRight size={13} /></a></div>
    <div className="mt-3 flex min-w-0 gap-2"><label className="filter-field min-w-0 flex-1"><Search size={15} className="shrink-0" /><input aria-label="搜索可选简历" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索名称、岗位或技术栈" /></label><button type="button" aria-label="刷新简历列表" disabled={loading} className="round-button shrink-0" onClick={() => setRefresh(n => n + 1)}><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button></div>
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}，请点击刷新重试。已保存的简历选择会继续保留。</p>}
    <label className="mt-3 block text-xs text-[#66735e]">从简历管理中选择<select aria-label="申请使用的简历" className="source-input mt-2 w-full font-normal" disabled={loading || !!error} value={selectedKey} onChange={event => onChange(rows.find(row => keyOf(row) === event.target.value) || null)}>
      <option value="">暂不选择 / 仅填写说明</option>
      {value && !found && <option value={selectedKey}>{value.name} · v{value.version}（本次已保存或已选版本）</option>}
      {rows.map(row => <option key={keyOf(row)} value={keyOf(row)}>{row.name} · {row.target_role} · v{row.version}</option>)}
    </select></label>
    {!loading && !error && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#73816a]"><span>{pages.total ? `共 ${pages.total} 份 · 第 ${pages.page} / ${pages.totalPages} 页` : search ? "没有匹配的简历，请更换关键词。" : "简历库暂无记录，可先点击“管理简历”新建。"}</span>{pages.totalPages > 1 && <><button type="button" className="ml-auto underline disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(n => n - 1)}>上一页简历</button><button type="button" className="underline disabled:opacity-40" disabled={page >= pages.totalPages} onClick={() => setPage(n => n + 1)}>下一页简历</button></>}</div>}
    {value && <div aria-label="已选申请简历" className="mt-3 min-w-0 rounded-xl border border-[#d8ddd2] bg-white p-3"><p className="break-words text-sm font-medium text-[#35522b]">{value.name} <span className="text-xs font-normal">v{value.version}</span></p><p className="mt-1 break-words text-xs text-[#73816a]">目标岗位：{value.target_role}</p>{value.pdf_name && <p className="mt-1 break-all text-xs text-[#73816a]">PDF：{value.pdf_name}</p>}{!!value.tech_stack.length && <div className="mt-2 flex flex-wrap gap-1">{value.tech_stack.map(tag => <span key={tag} className="tag">{tag}</span>)}</div>}<button type="button" className="mt-3 text-xs text-[#965b50] underline" onClick={() => onChange(null)}>取消简历选择</button></div>}
    <p className="mt-3 text-xs leading-5 text-[#75806e]">点击“保存申请资料”后记录本次所选名称和版本；简历库之后的修改不会自动更新这条申请记录。PDF 可在简历管理查看。</p>
  </section>;
}
