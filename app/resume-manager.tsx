"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarDays, Check, Download, Eye, FileText, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { RESUME_TIME_ZONE, resumeLocalTime, resumeLocalToIso, type ResumeRecord, type ResumeSummary } from "@/lib/resume-types";
import { validateResumePdf } from "@/lib/resume-pdf";
import { useLanguage } from "./language-provider";

type Pages = { page: number; pageSize: number; total: number; totalPages: number };
const dateLabel = (value: string, locale: string) => new Date(value).toLocaleString(locale, { timeZone: RESUME_TIME_ZONE, hour12: false });
function useResumeDialog(open: boolean, onClose: () => void, busy: boolean) {
  const panel = useRef<HTMLElement>(null), close = useRef(onClose), pending = useRef(busy);
  close.current = onClose; pending.current = busy;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (panel.current?.querySelector<HTMLElement>("input,textarea") || panel.current?.querySelector<HTMLElement>("button"))?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending.current) close.current();
      if (event.key !== "Tab") return;
      const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href],[tabindex="0"]') || [])].filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", listener);
    return () => { document.removeEventListener("keydown", listener); document.body.style.overflow = overflow; previous?.focus(); };
  }, [open]);
  return panel;
}

export default function ResumeManager() {
  const { locale, t } = useLanguage();
  const [records, setRecords] = useState<ResumeSummary[]>([]), [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const [pages, setPages] = useState<Pages>({ page: 1, pageSize: 12, total: 0, totalPages: 1 });
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<{ id: number | null } | null>(null);
  const [deleting, setDeleting] = useState<ResumeSummary | null>(null), [removing, setRemoving] = useState(false);
  const confirmPanel = useResumeDialog(!!deleting, () => setDeleting(null), removing);
  useEffect(() => { const timer = setTimeout(() => { setSearch(query); setPage(1); }, 300); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    (async () => {
      try {
        const response = await fetch(`/api/resumes?${new URLSearchParams({ q: search, page: String(page) })}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json() as { resumes: ResumeSummary[]; pagination: Pages; error?: string };
        if (!response.ok) throw new Error(data.error || "简历读取失败");
        if (controller.signal.aborted) return;
        setRecords(data.resumes); setPages(data.pagination);
        if (data.pagination.page !== page) setPage(data.pagination.page);
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "简历读取失败"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [search, page, refresh]);
  async function remove() {
    if (!deleting || removing) return;
    setRemoving(true); setError("");
    try {
      const response = await fetch(`/api/resumes/${deleting.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: deleting.version }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "删除简历失败");
      setNotice("简历已删除");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "删除简历失败"); }
    finally { setRemoving(false); setDeleting(null); setRefresh(n => n + 1); }
  }
  function saved() { setEditor(null); setPage(1); setQuery(""); setSearch(""); setRefresh(n => n + 1); setNotice("简历已保存"); }
  return <section aria-label={t("简历管理")}>
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">Resume library</p><h1 className="mt-2 text-3xl font-semibold">{t("简历管理")}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-radar-muted">{t("为不同岗位准备不同版本，记录目标岗位、创建时间和匹配技术栈。简历保存在本机，不随职位清理。")}</p></div><button onClick={() => setEditor({ id: null })} className="sync-button"><Plus size={16} />{t("新建简历")}</button></div>
    {notice && <div role="status" className="mb-4 flex items-center justify-between rounded-xl border border-radar-border bg-radar-soft px-4 py-3 text-sm text-radar-strong">{notice}<button onClick={() => setNotice("")} aria-label={t("关闭简历提示")}><X size={16} /></button></div>}
    {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{t(error)}</p>}
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><label className="filter-field w-full max-w-xl border-radar-line bg-white"><Search size={17} /><input aria-label={t("搜索简历")} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("搜索名称、目标岗位、说明或技术栈…")} /></label><p className="text-xs text-radar-subtle">{search ? t("找到") : t("共")} {pages.total} {t("份简历 · 按最近编辑排序")}</p></div>
    {loading ? <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{[1,2,3].map(id => <div key={id} className="h-60 animate-pulse rounded-2xl border border-radar-line bg-white/70" />)}</div> : !error && !records.length ? <div className="rounded-3xl border border-dashed border-radar-border bg-white/70 px-6 py-16 text-center"><FileText className="mx-auto text-radar-subtle" size={36} /><h2 className="mt-4 text-lg font-semibold">{search ? t("没有匹配的简历") : t("建立你的第一份简历档案")}</h2><p className="mt-2 text-sm text-radar-subtle">{search ? t("试试岗位名或技术栈关键词。") : t("例如：后端实习版、AI Engineer 应届版。")}</p><button className="sync-button mt-5" onClick={() => search ? setQuery("") : setEditor({ id: null })}>{search ? t("清空搜索") : t("新建简历")}</button></div> : !error && <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{records.map(record => <article key={record.id} data-resume-id={record.id} className="flex min-w-0 flex-col rounded-2xl border border-radar-line bg-white p-5 shadow-[0_4px_20px_rgba(27,64,102,.025)]">
      <div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-radar-soft text-radar-muted"><FileText size={20} /></div><div className="min-w-0 flex-1"><h2 className="break-words font-semibold text-radar-ink">{record.name}</h2><p className="mt-1 break-words text-sm text-radar-muted">{t("目标岗位：")}{record.target_role}</p></div></div>
      <p className="mt-4 line-clamp-3 min-h-12 break-words text-sm leading-6 text-radar-subtle">{record.summary || t("尚未填写简短说明，可记录这版简历的侧重点。")}</p>
      <div className="mt-4 flex flex-wrap gap-1.5" aria-label={t("简历匹配的技术栈")}>{record.tech_stack.length ? <>{record.tech_stack.slice(0,10).map(tag => <span key={tag} className="tag">{tag}</span>)}{record.tech_stack.length > 10 && <span className="tag">+{record.tech_stack.length - 10}</span>}</> : <span className="text-xs text-radar-subtle">{t("暂无技术栈标签")}</span>}</div>
      <p className="mb-4 mt-5 flex items-start gap-1.5 text-xs leading-5 text-radar-subtle"><CalendarDays size={14} className="mt-0.5 shrink-0" />{t("创建时间：{0}（纽约）", dateLabel(record.created_at, locale))}</p>
      {record.pdf_name && <a href={`/api/resumes/${record.id}/pdf`} target="_blank" rel="noopener noreferrer" aria-label={t("查看 PDF {0}", record.name)} className="mb-4 flex min-w-0 items-center gap-2 rounded-xl bg-radar-soft p-3 text-xs text-radar-strong"><Eye size={15} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{record.pdf_name}</span><span className="shrink-0">{t("查看 PDF")}</span></a>}
      <div className="mt-auto flex items-center justify-between border-t border-radar-tint pt-3"><button onClick={() => setEditor({ id: record.id })} aria-label={t("编辑简历 {0}", record.name)} className="icon-button text-radar-strong"><Pencil size={14} />{t("查看 / 编辑")}</button><button onClick={() => setDeleting(record)} aria-label={t("删除简历 {0}", record.name)} className="round-button text-[#965b50]"><Trash2 size={15} /></button></div>
    </article>)}</div>}
    {!loading && !error && pages.total > 0 && <nav aria-label={t("简历分页")} className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-radar-line bg-white p-3 text-sm"><button className="icon-button" disabled={page <= 1} onClick={() => setPage(n => n - 1)}>{t("上一页")}</button><span className="text-xs text-radar-subtle">{t("第")} {pages.page} / {pages.totalPages} {t("页 · 每页")} {pages.pageSize} {t("份")}</span><button className="icon-button" disabled={page >= pages.totalPages} onClick={() => setPage(n => n + 1)}>{t("下一页")}</button></nav>}
    {editor && <ResumeEditor key={editor.id ?? "new"} id={editor.id} onClose={() => setEditor(null)} onSaved={saved} />}
    {deleting && <div className="fixed inset-0 z-50 grid place-items-center bg-radar-overlay/35 p-4 backdrop-blur-sm"><section ref={confirmPanel} role="alertdialog" aria-modal="true" aria-labelledby="delete-resume-title" className="w-full max-w-md rounded-2xl bg-radar-paper p-6 shadow-xl"><h2 id="delete-resume-title" className="text-xl font-semibold">{t("删除这份简历？")}</h2><p className="mt-3 break-words text-sm leading-6 text-radar-muted">{t("将删除「")}{deleting.name}{t("」、保存的正文及 PDF 文件。申请记录中已有的简历说明会保留。")}</p><div className="mt-6 flex justify-end gap-3"><button disabled={removing} onClick={() => setDeleting(null)} className="icon-button">{t("取消")}</button><button disabled={removing} onClick={remove} className="rounded-xl bg-[#984a3c] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{removing ? t("删除中…") : t("确认删除")}</button></div></section></div>}
  </section>;
}

type Draft = { name: string; target_role: string; summary: string; created_at: string; tags: string; content: string };
function ResumeEditor({ id, onClose, onSaved }: { id: number | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<Draft>(() => ({ name: "", target_role: "", summary: "", created_at: resumeLocalTime(new Date().toISOString()), tags: "", content: "" }));
  const [original, setOriginal] = useState<ResumeRecord | null>(null), [loading, setLoading] = useState(id !== null), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [conflict, setConflict] = useState(false), [reload, setReload] = useState(0);
  const [pdf, setPdf] = useState<File | null | undefined>(), [blobUrl, setBlobUrl] = useState(""), [showPdf, setShowPdf] = useState(false), [checkingPdf, setCheckingPdf] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null), selection = useRef(0);
  const nameInput = useRef<HTMLInputElement>(null), panel = useResumeDialog(true, onClose, saving || checkingPdf);
  useEffect(() => {
    if (!pdf) { setBlobUrl(""); return; }
    const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" })); setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pdf]);
  useEffect(() => () => { selection.current++; }, []);
  useEffect(() => { if (!loading) nameInput.current?.focus(); }, [loading]);
  useEffect(() => {
    if (id === null) return;
    const controller = new AbortController(); setLoading(true); setError("");
    (async () => {
      try {
        const response = await fetch(`/api/resumes/${id}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json() as { resume: ResumeRecord; error?: string };
        if (!response.ok) throw new Error(data.error || "简历读取失败");
        if (controller.signal.aborted) return;
        const record = data.resume; setOriginal(record); setConflict(false);
        setPdf(undefined); setShowPdf(false);
        setDraft({ name: record.name, target_role: record.target_role, summary: record.summary, created_at: resumeLocalTime(record.created_at), tags: record.tech_stack.join(", "), content: record.content });
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "读取失败"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [id, reload]);
  function field<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft(previous => ({ ...previous, [key]: value })); }
  async function selectPdf(file: File | undefined) {
    if (!file) return;
    const token = ++selection.current; setCheckingPdf(true); setError("");
    try {
      await validateResumePdf(file);
      if (token !== selection.current) return;
      setPdf(file); setShowPdf(true);
      setDraft(previous => previous.name ? previous : { ...previous, name: file.name.replace(/\.pdf$/i, "") });
    } catch (failure) { if (token === selection.current) setError(failure instanceof Error ? failure.message : "PDF 读取失败"); }
    finally { if (token === selection.current) { setCheckingPdf(false); if (fileInput.current) fileInput.current.value = ""; } }
  }
  const hasPdf = pdf === null ? false : !!pdf || !!original?.pdf_name;
  const pdfName = pdf?.name || original?.pdf_name || "";
  const pdfSize = pdf?.size ?? original?.pdf_size ?? 0;
  const pdfUrl = pdf ? blobUrl : original && hasPdf ? `/api/resumes/${original.id}/pdf?v=${original.version}` : "";
  async function save(event: FormEvent) {
    event.preventDefault(); if (saving || loading || checkingPdf || id !== null && !original) return;
    setSaving(true); setError("");
    try {
      const created_at = original && draft.created_at === resumeLocalTime(original.created_at) ? original.created_at : resumeLocalToIso(draft.created_at);
      const body = { name: draft.name, target_role: draft.target_role, summary: draft.summary, created_at,
        tech_stack: draft.tags.split(/[,，、;；\n]/).map(tag => tag.trim()).filter(Boolean), content: draft.content, ...(original ? { version: original.version } : {}) };
      let requestBody: string | FormData = JSON.stringify(body);
      if (pdf !== undefined) {
        const form = new FormData(); form.append("data", requestBody);
        if (pdf) form.append("pdf", pdf); else form.append("remove_pdf", "true");
        requestBody = form;
      }
      const response = await fetch(id === null ? "/api/resumes" : `/api/resumes/${id}`, { method: id === null ? "POST" : "PATCH", ...(typeof requestBody === "string" ? { headers: { "content-type": "application/json" } } : {}), body: requestBody });
      const data = await response.json() as { error?: string };
      if (!response.ok) { setConflict(response.status === 409); throw new Error(data.error || "保存失败"); }
      onSaved();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-radar-overlay/35 p-3 backdrop-blur-sm sm:p-5"><section ref={panel} role="dialog" aria-modal="true" aria-labelledby="resume-editor-title" className="max-h-[94dvh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-radar-paper p-5 shadow-2xl sm:p-7">
    <div className="mb-5 flex items-start justify-between gap-3"><div><p className="eyebrow">Resume details</p><h2 id="resume-editor-title" className="mt-1 text-2xl font-semibold">{id === null ? t("新建简历") : t("编辑简历")}</h2><p className="mt-2 text-xs leading-5 text-radar-subtle">{t("按目标岗位整理版本，可上传 PDF 并预览；点击保存后文件才会保存到本地。")}</p></div><button disabled={saving || checkingPdf} onClick={onClose} aria-label={t("关闭简历编辑")} className="round-button shrink-0"><X size={18} /></button></div>
    {error && <div role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}{conflict && <><p className="mt-2 text-xs">{t("先复制需要保留的未保存内容；重新载入会替换当前表单。")}</p><button type="button" onClick={() => setReload(n => n + 1)} className="mt-2 underline">{t("重新载入服务器版本")}</button></>}</div>}
    {loading ? <div className="h-72 animate-pulse rounded-2xl bg-radar-tint" /> : <form onSubmit={save}><fieldset disabled={saving} className="min-w-0 space-y-4">
      <section aria-label={t("简历 PDF")} className="rounded-2xl border border-radar-line bg-radar-soft p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h3 className="text-sm font-semibold">{t("PDF 简历")}</h3><p className="mt-1 text-xs text-radar-subtle">{t("每份简历可保存一个 PDF，最大 10 MB。")}</p></div><button type="button" disabled={checkingPdf} onClick={() => fileInput.current?.click()} className="icon-button"><Upload size={15} />{checkingPdf ? t("检查文件中…") : hasPdf ? t("替换 PDF") : t("上传 PDF")}</button></div>
        <input ref={fileInput} type="file" accept="application/pdf,.pdf" aria-label={t("上传简历 PDF")} tabIndex={-1} className="sr-only" disabled={checkingPdf} onChange={event => { void selectPdf(event.target.files?.[0]); }} />
        {hasPdf && <><p className="mt-3 break-all text-sm text-radar-strong">{pdfName}<span className="ml-2 text-xs text-radar-subtle">{(pdfSize / 1024 / 1024).toFixed(2)} MB · {pdf ? t("待保存") : t("已保存")}</span></p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setShowPdf(value => !value)} className="icon-button"><Eye size={15} />{showPdf ? t("收起预览") : t("预览 PDF")}</button>{pdfUrl && <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="icon-button">{t("新窗口查看")}</a>}{pdfUrl && <a href={pdf ? pdfUrl : `${pdfUrl}&download=1`} download={pdfName} className="icon-button"><Download size={15} />{t("下载")}</a>}<button type="button" disabled={checkingPdf} onClick={() => { setPdf(null); setShowPdf(false); }} className="icon-button text-[#965b50]">{t("移除 PDF")}</button></div>{showPdf && pdfUrl && <div className="mt-3"><iframe key={pdfUrl} src={pdfUrl} title={t("简历 PDF 预览")} className="h-[480px] w-full rounded-xl border border-radar-line bg-white" /><p className="mt-2 text-xs leading-5 text-radar-subtle">{t("如浏览器无法内嵌显示，请使用“新窗口查看”或“下载”。")}</p></div>}</>}
        {pdf === null && original?.pdf_name && <p className="mt-3 text-xs text-[#965b50]">{t("保存后将移除原 PDF。")}<button type="button" onClick={() => setPdf(undefined)} className="ml-2 underline">{t("撤销移除")}</button></p>}
      </section>
      <label className="block text-sm font-medium">{t("简历名称")}<input ref={nameInput} required maxLength={120} value={draft.name} onChange={event => field("name", event.target.value)} className="source-input mt-2 w-full" placeholder={t("例如：后端实习版 v1")} /></label>
      <label className="block text-sm font-medium">{t("目标岗位")}<input required maxLength={160} value={draft.target_role} onChange={event => field("target_role", event.target.value)} className="source-input mt-2 w-full" placeholder={t("这份简历是为哪个岗位准备的？")} /></label>
      <label className="block text-sm font-medium">{t("简历创建时间（纽约）")}<input required type="datetime-local" step={1} value={draft.created_at} onChange={event => field("created_at", event.target.value)} className="source-input mt-2 w-full" /></label>
      <label className="block text-sm font-medium">{t("简短说明")}<textarea maxLength={500} rows={3} value={draft.summary} onChange={event => field("summary", event.target.value)} className="mt-2 w-full resize-y rounded-xl border border-radar-line bg-white p-3 text-sm outline-none focus:border-radar-focus" placeholder={t("例如：突出分布式系统项目，面向后端应届岗位。")} /></label>
      <label className="block text-sm font-medium">{t("匹配技术栈")}<input value={draft.tags} onChange={event => field("tags", event.target.value)} maxLength={2500} className="source-input mt-2 w-full" placeholder="Python, Go, PostgreSQL, Kubernetes" /><span className="mt-1 block text-xs font-normal text-radar-subtle">{t("用逗号分隔，最多 40 个标签。")}</span></label>
      <label className="block text-sm font-medium">{t("简历正文（可选）")}<textarea maxLength={100000} rows={8} value={draft.content} onChange={event => field("content", event.target.value)} className="mt-2 w-full resize-y rounded-xl border border-radar-line bg-white p-3 text-sm leading-6 outline-none focus:border-radar-focus" placeholder={t("可粘贴这版简历的正文，内容保存在本地。")} /></label>
      <div className="sticky -bottom-5 flex items-center justify-end gap-3 border-t border-radar-line bg-radar-paper py-4 sm:-bottom-7"><button type="button" disabled={saving || checkingPdf} onClick={onClose} className="icon-button">{t("取消")}</button><button type="submit" disabled={saving || checkingPdf || id !== null && !original} className="sync-button"><Check size={15} />{saving ? t("保存中…") : pdf ? t("保存简历及 PDF") : t("保存简历")}</button></div>
    </fieldset></form>}
  </section></div>;
}
