"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowUpRight, Check, FileText, Plus, Search, Trash2, X } from "lucide-react";
import { applicationStatuses, type ApplicationEvent, type ApplicationRecord, type ApplicationStatus } from "@/lib/application-types";
import { ClassificationTags, JobAnalysisPanel } from "@/components/job-classification";

type Pages = { page: number; pageSize: number; total: number; totalPages: number };
type DetailResponse = { application: ApplicationRecord; history: ApplicationEvent[]; error?: string };
function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未填写";
}
function localInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function toTimestamp(value: string, previous: string | null) {
  if (!value) return null;
  return value === localInput(previous) ? previous : new Date(value).toISOString();
}

export function ApplicationTracker({ refreshKey, onOpen }: { refreshKey: number; onOpen: (id: number) => void }) {
  const [records, setRecords] = useState<Omit<ApplicationRecord, "description">[]>([]);
  const [query, setQuery] = useState(""), [search, setSearch] = useState("");
  const [status, setStatus] = useState(""), [page, setPage] = useState(1), [jump, setJump] = useState("1");
  const [pages, setPages] = useState<Pages>({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => { const timer = setTimeout(() => { setSearch(query); setPage(1); }, 300); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = new URLSearchParams({ q: search, status, page: String(page) });
    (async () => {
      try {
        const response = await fetch(`/api/applications?${params}`, { signal: controller.signal });
        const data = await response.json() as { applications: Omit<ApplicationRecord, "description">[]; pagination: Pages; error?: string };
        if (!response.ok) throw new Error(data.error || "申请记录读取失败");
        if (controller.signal.aborted) return;
        setRecords(data.applications); setPages(data.pagination); setJump(String(data.pagination.page));
        if (data.pagination.page !== page) setPage(data.pagination.page);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "读取失败"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [search, status, page, refreshKey]);

  return <section>
    <p className="eyebrow">我的求职进度</p>
    <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">申请职位状态</h1>
    <p className="mt-4 max-w-2xl text-sm leading-6 text-[#697169]">在全部职位中点击「＋」加入这里，记录简历、邮箱和申请进度。每条记录保留职位与 JD 快照，超过 7 天也会继续保存。</p>
    <div className="my-6 grid gap-3 rounded-2xl border border-[#dfe2d8] bg-white p-3 sm:grid-cols-[1fr_220px_auto]">
      <label className="filter-field"><Search size={17} /><input aria-label="搜索申请记录" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索公司、职位或申请邮箱…" /></label>
      <select aria-label="筛选申请状态" className="source-input" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">全部状态</option>{Object.entries(applicationStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <a href="/" className="sync-button justify-center"><Plus size={16} />添加职位</a>
    </div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-[#697169]"><span>共 {pages.total} 条申请记录 · 第 {pages.page} / {pages.totalPages} 页</span><span className="text-xs">每页 50 条 · 按最近修改排序</span></div>
    {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {loading ? <div className="h-44 animate-pulse rounded-2xl bg-white" /> : records.length ? <div className="grid gap-3 lg:grid-cols-2">{records.map(record => <button key={record.id} onClick={() => onOpen(record.id)} className="job-card w-full text-left">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs text-[#697169]">{record.company}</p><h2 className="mt-1 font-semibold">{record.title}</h2><p className="mt-2 text-xs text-[#697169]">{record.location}</p></div><span className="shrink-0 rounded-full bg-[#e5eedb] px-3 py-1 text-xs text-[#36531f]">{applicationStatuses[record.status]}</span></div>
      <dl className="mt-5 grid gap-2 text-xs text-[#697169]"><div><dt className="inline">申请时间：</dt><dd className="inline">{dateLabel(record.applied_at)}</dd></div><div><dt className="inline">状态达到时间：</dt><dd className="inline">{dateLabel(record.status_at)}</dd></div><div className="truncate"><dt className="inline">申请邮箱：</dt><dd className="inline">{record.email || "尚未填写"}</dd></div><div className="truncate"><dt className="inline">所用简历：</dt><dd className="inline">{record.resume || "尚未填写"}</dd></div></dl>
      <p className="mt-4 flex items-center gap-1 text-xs font-medium text-[#365b3c]">编辑资料与状态时间线 <ArrowUpRight size={14} /></p>
    </button>)}</div> : !error && <div className="rounded-2xl border border-dashed border-[#cbd0c7] bg-white/60 px-6 py-16 text-center"><FileText className="mx-auto text-[#69805d]" size={32} /><h2 className="mt-4 text-xl font-semibold">{search || status ? "没有符合条件的申请记录" : "从第一个申请开始"}</h2><p className="mt-3 text-sm text-[#697169]">{search || status ? "试试其他搜索词或状态。" : "去全部职位点击「＋」，再填写你使用的简历和申请信息。"}</p></div>}
    <nav aria-label="申请记录分页" className="my-5 flex flex-wrap items-center gap-3 text-sm"><button className="icon-button" disabled={loading || pages.page <= 1} onClick={() => setPage(page-1)}>上一页</button><span>{pages.page} / {pages.totalPages}</span><button className="icon-button" disabled={loading || pages.page >= pages.totalPages} onClick={() => setPage(page+1)}>下一页</button><form className="ml-auto flex items-center gap-2" onSubmit={e => { e.preventDefault(); const n = Number(jump); if (Number.isSafeInteger(n) && n >= 1 && n <= pages.totalPages) setPage(n); }}><input aria-label="申请记录跳转页码" className="source-input w-20" type="number" min={1} max={pages.totalPages} value={jump} onChange={e => setJump(e.target.value)} /><button disabled={loading} className="icon-button">跳转</button></form></nav>
  </section>;
}

export function ApplicationEditor({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: (removed?: boolean) => void }) {
  const [record, setRecord] = useState<ApplicationRecord | null>(null), [history, setHistory] = useState<ApplicationEvent[]>([]);
  const [resume, setResume] = useState(""), [email, setEmail] = useState(""), [appliedAt, setAppliedAt] = useState("");
  const [status, setStatus] = useState<ApplicationStatus>("saved"), [statusAt, setStatusAt] = useState("");
  const [saving, setSaving] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  function populate(data: { application: ApplicationRecord; history: ApplicationEvent[] }) {
    const app = data.application;
    setRecord(app); setHistory(data.history); setResume(app.resume); setEmail(app.email);
    setAppliedAt(localInput(app.applied_at)); setStatus(app.status); setStatusAt(localInput(app.status_at));
  }
  useEffect(() => {
    const controller = new AbortController();
    (async () => { try {
      const response = await fetch(`/api/applications/${id}`, { signal: controller.signal });
      const data = await response.json() as DetailResponse;
      if (!response.ok) throw new Error(data.error || "读取失败");
      if (!controller.signal.aborted) populate(data);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "读取失败"); }
    finally { if (!controller.signal.aborted) setLoading(false); } })();
    const previousFocus = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();
    const bodyOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { controller.abort(); document.body.style.overflow = bodyOverflow; if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [id]);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onClose(); }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, [saving, onClose]);
  async function save(e: FormEvent) {
    e.preventDefault(); if (!record || saving) return;
    setSaving(true); setError(""); setSaved(false);
    try {
      const response = await fetch(`/api/applications/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resume, email, applied_at: toTimestamp(appliedAt, record.applied_at), status, status_at: toTimestamp(statusAt, record.status_at), version: record.version }) });
      const data = await response.json() as DetailResponse; if (!response.ok) throw new Error(data.error || "保存失败");
      populate(data); setSaved(true); onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
    finally { setSaving(false); }
  }
  async function remove() {
    if (saving || !window.confirm("移除此申请记录及其状态时间线？职位列表中的原始职位会保留。")) return;
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/applications/${id}`, { method: "DELETE" });
      const data = await response.json() as { error?: string }; if (!response.ok) throw new Error(data.error || "移除失败");
      onChanged(true); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "移除失败"); }
    finally { setSaving(false); }
  }
  return <div className="fixed inset-0 z-50 flex justify-end bg-[#102016]/35 backdrop-blur-[2px]" onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose(); }}><section role="dialog" aria-modal="true" aria-labelledby="application-title" className="h-full w-full max-w-3xl overflow-y-auto bg-[#fbfbf7] p-5 shadow-2xl sm:p-9" onKeyDown={e => {
    if (e.key !== "Tab") return;
    const focusable = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary')].filter(element => element.getClientRects().length);
    const first = focusable[0], last = focusable[focusable.length-1];
    if (!first) { e.preventDefault(); return; }
    if (e.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }}>
    <div className="flex items-center justify-between"><h2 id="application-title" ref={titleRef} tabIndex={-1} className="text-xl font-semibold outline-none">申请资料与进度</h2><button aria-label="关闭申请资料" disabled={saving} className="round-button" onClick={onClose}><X size={18} /></button></div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading ? <p className="my-10 text-sm text-[#697169]">正在读取申请资料…</p> : record && <>
      <div className="mt-7"><p className="text-sm text-[#697169]">{record.company} · {record.location}</p><h3 className="mt-1 text-2xl font-semibold">{record.title}</h3><a className="mt-3 inline-flex items-center gap-1 text-sm text-[#3c6a42]" href={record.apply_url || record.canonical_url} target="_blank" rel="noreferrer">打开原职位 <ArrowUpRight size={15} /></a></div>
      <ClassificationTags analysis={record.classification} />
      <form onSubmit={save} onChange={() => setSaved(false)} className="mt-7"><fieldset disabled={saving} className="space-y-5">
        <label className="block text-sm font-medium">申请使用的简历<textarea className="source-input mt-2 min-h-24 w-full font-normal" maxLength={4000} value={resume} onChange={e => setResume(e.target.value)} placeholder="例如：英文后端简历 v3.pdf，或简历链接、版本说明" /><span className="mt-1 block text-xs font-normal text-[#7b827b]">保存简历名称、版本或链接；此处填写文字，不上传文件。</span></label>
        <label className="block text-sm font-medium">申请使用的邮箱<input className="source-input mt-2 w-full font-normal" type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="your.name@example.com" /></label>
        <p className="text-xs text-[#7b827b]">以下时间按本机时区（{Intl.DateTimeFormat().resolvedOptions().timeZone}）填写和显示。</p>
        <label className="block text-sm font-medium">申请时间<input className="source-input mt-2 w-full font-normal" type="datetime-local" step="1" value={appliedAt} onChange={e => setAppliedAt(e.target.value)} /></label>
        <div className="grid gap-5 sm:grid-cols-2"><label className="block text-sm font-medium">申请状态<select className="source-input mt-2 w-full font-normal" value={status} onChange={e => { const next = e.target.value as ApplicationStatus; setStatus(next); setStatusAt(localInput(new Date().toISOString())); if (next === "applied" && !appliedAt) setAppliedAt(localInput(new Date().toISOString())); }}>{Object.entries(applicationStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="block text-sm font-medium">何时达到此状态<input className="source-input mt-2 w-full font-normal" required type="datetime-local" step="1" value={statusAt} onChange={e => setStatusAt(e.target.value)} /></label></div>
        <p className="text-xs leading-5 text-[#7b827b]">修改状态后点击保存，会追加一条状态记录。只修正当前状态的时间时，会更新最后一条记录的时间。</p>
        <div className="flex flex-wrap items-center gap-3"><button disabled={saving} className="sync-button"><Check size={16} />{saving ? "正在保存…" : "保存申请资料"}</button>{saved && <span role="status" className="text-sm text-[#46713b]">已保存</span>}<button type="button" disabled={saving} onClick={remove} className="ml-auto flex items-center gap-1 text-xs text-[#985c50]"><Trash2 size={14} />移除跟踪</button></div>
      </fieldset></form>
      <section className="mt-9 border-t border-[#dfe2d8] pt-6"><h3 className="font-semibold">状态时间线</h3><ol className="mt-5 space-y-4 border-l-2 border-[#d4dfcc] pl-5">{history.map(event => <li key={event.id}><strong className="text-sm font-medium">{applicationStatuses[event.status]}</strong><p className="mt-1 text-xs text-[#697169]">{dateLabel(event.reached_at)}</p></li>)}</ol></section>
      <details className="mt-8 rounded-xl border border-[#dfe2d8] p-4"><summary className="cursor-pointer text-sm font-medium">保存的职位描述（JD）</summary><p className="mt-2 text-xs text-[#7b827b]">来源：{record.source_name} · 加入于 {dateLabel(record.created_at)}</p><JobAnalysisPanel analysis={record.classification} /><div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-[#434b44]">{record.description || "该职位未提供 JD，请查看原职位页面。"}</div></details>
    </>}
  </section></div>;
}
