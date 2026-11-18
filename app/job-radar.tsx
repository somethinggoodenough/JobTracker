"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApplicationEditor, ApplicationTracker } from "./application-tracker";
import AiFilterPanel from "./ai-filter-panel";
import ResumeManager from "./resume-manager";
import { ClassificationTags, JobAnalysisPanel } from "@/components/job-classification";
import { careerLevels, jobCategories, type JobAnalysis } from "@/lib/classification-types";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowUpRight, Building2, Check, ChevronRight, Clock3, Database, ExternalLink,
  Globe2, Layers3, MapPin, Plus, Radar, RefreshCw, Search, Settings2, Sparkles,
  Trash2, X, Zap, ClipboardList, FileText,
} from "lucide-react";

type Job = {
  id: number; application_id?: number | null; company: string; title: string; location: string; workplace_type?: string;
  employment_type?: string; department?: string; salary?: string; description: string;
  posted_at: string; first_seen_at: string; apply_url: string; canonical_url: string; source_name: string;
  classification: JobAnalysis | null;
  publication_verified: number;
};
type Source = { id: number; name: string; url: string; adapter: string; enabled: number; job_count: number; last_success_at?: string; last_error?: string };
type Stats = { total: number; companies: number; new_today: number };
type Pages = { page: number; pageSize: number; total: number; totalPages: number };
type View = "jobs" | "applications" | "resumes" | "sources" | "runs";
type Run = { status: string; started_at: string; jobs_added: number; jobs_deleted: number } | null;
type SourceProgress = {
  source_id: number; name: string; url: string; stage: string; started_at: string | null;
  finished_at: string | null; updated_at: string; jobs_total: number; jobs_processed: number;
  jobs_added: number; jobs_updated: number; jobs_ignored: number; jobs_queued: number; error: string | null;
};
type SyncProgress = {
  run: { id: number; status: string; started_at: string; finished_at: string | null;
    sources_total: number; jobs_deleted: number } | null;
  sources: SourceProgress[];
};

function relativeTime(date?: string) {
  if (!date) return "尚未同步";
  const hours = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 3_600_000));
  if (hours < 1) return "刚刚";
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

const adapterName: Record<string, string> = {
  github_jobs: "GitHub / Simplify 职位列表",
  feishu: "飞书招聘", moka: "Moka", beisen: "北森 / Zhiye", gem: "Gem", salesforce: "Salesforce 专用",
  dify: "Dify 专用", xiaomi: "小米专用", kuaishou: "快手专用", meituan: "美团专用", alibaba: "阿里招聘",
  netease: "网易专用", xiaohongshu: "小红书专用", jdcom: "京东专用", tiktok: "TikTok 专用", meta: "Meta 专用", baidu: "百度专用", antgroup: "蚂蚁集团专用",
  amazon: "Amazon / AWS 专用", google: "Google 专用", eightfold: "Eightfold", oracle: "Oracle Fusion",
  tencent: "腾讯专用", jibe: "Jibe / iCIMS", smartrecruiters: "SmartRecruiters", apple: "Apple 专用", paycor: "Paycor", comeet: "Comeet",
  greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday", workable: "Workable", jsonld: "通用网页", auto: "自动识别",
};

export default function JobRadar({ view = "jobs" }: { view?: View }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, companies: 0, new_today: 0 });
  const [latestRun, setLatestRun] = useState<Run>(null);
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [mode, setMode] = useState("全部方式");
  const [category, setCategory] = useState(""), [level, setLevel] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState<Pages>({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [searchFilters, setSearchFilters] = useState({ query: "", location: "" });
  const loadId = useRef(0);
  const [selected, setSelected] = useState<Job | null>(null);
  const [applicationId, setApplicationId] = useState<number | null>(null);
  const [applicationRefresh, setApplicationRefresh] = useState(0);
  const [addingJobs, setAddingJobs] = useState<Set<number>>(new Set());
  const addingJobsRef = useRef(new Set<number>());
  const [showSources, setShowSources] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [cancelSending, setCancelSending] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [progressError, setProgressError] = useState("");
  const runActive = progress?.run?.status === "running" || progress?.run?.status === "cancelling";
  const isSyncing = syncing || runActive;
  const isCancelling = cancelSending || progress?.run?.status === "cancelling";
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setSearchFilters({ query, location }), 300);
    return () => clearTimeout(timer);
  }, [query, location]);

  const load = useCallback(async () => {
    const requestId = ++loadId.current;
    const params = new URLSearchParams({ page: String(page), q: searchFilters.query, location: searchFilters.location,
      type: mode === "全部方式" ? "" : mode, period: "all", category, level });
    const [jobResponse, sourceResponse] = await Promise.all([fetch(`/api/jobs?${params}`), fetch("/api/sources")]);
    const jobData = await jobResponse.json() as { jobs?: Job[]; stats?: Stats; latestRun?: Run; pagination?: Pages; error?: string };
    const sourceData = await sourceResponse.json() as { sources?: Source[]; error?: string };
    if (requestId !== loadId.current) return;
    if (!jobResponse.ok) throw new Error(jobData.error || "职位读取失败");
    setJobs(jobData.jobs ?? []); setStats(jobData.stats ?? { total: 0, companies: 0, new_today: 0 }); setLatestRun(jobData.latestRun ?? null);
    if (jobData.pagination) { setPages(jobData.pagination); if (jobData.pagination.page !== page) setPage(jobData.pagination.page); }
    setSources(sourceData.sources ?? []); setLoading(false);
  }, [page, searchFilters, mode, view, category, level]);
  const latestLoad = useRef(load);
  latestLoad.current = load;

  useEffect(() => { setLoading(true); load().catch((e) => { setNotice(e.message); setLoading(false); }); }, [load]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let wasRunning = false;
    let lastJobsRefresh = 0;
    async function poll() {
      let running = false;
      try {
        const response = await fetch("/api/sync/progress", { cache: "no-store" });
        const data = await response.json() as SyncProgress & { error?: string };
        if (!response.ok) throw new Error(data.error || "进度读取失败");
        if (cancelled) return;
        running = data.run?.status === "running" || data.run?.status === "cancelling";
        setProgress(data); setProgressError("");
        if ((wasRunning && !running) || (running && Date.now()-lastJobsRefresh > 15000)) { lastJobsRefresh = Date.now(); await load(); }
        wasRunning = running;
      } catch (error) {
        if (!cancelled) setProgressError(error instanceof Error ? error.message : "进度读取失败");
      }
      if (!cancelled) timer = setTimeout(poll, syncing || running ? 1000 : 10000);
    }
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [syncing, load]);

  const filtered = jobs;

  async function addApplication(job: Job) {
    if (job.application_id) { setApplicationId(job.application_id); return; }
    if (addingJobsRef.current.has(job.id)) return;
    addingJobsRef.current.add(job.id); setAddingJobs(new Set(addingJobsRef.current));
    try {
      const response = await fetch("/api/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id }) });
      const data = await response.json() as { application: { id: number }; created: boolean; error?: string };
      if (!response.ok) throw new Error(data.error || "添加失败");
      setJobs(previous => previous.map(item => item.id === job.id ? { ...item, application_id: data.application.id } : item));
      setApplicationId(data.application.id); setApplicationRefresh(n => n+1);
      setNotice(data.created ? "已加入申请职位状态，可继续填写申请资料" : "该职位已在申请记录中");
    } catch (error) { setNotice(error instanceof Error ? error.message : "添加失败"); }
    finally { addingJobsRef.current.delete(job.id); setAddingJobs(new Set(addingJobsRef.current)); }
  }

  async function syncNow() {
    return startSync(false);
  }
  async function startSync(reviewOnly: boolean) {
    if (isSyncing) return;
    setSyncing(true); setNotice("");
    try {
      const response = await fetch(reviewOnly ? "/api/sync?reviewOnly=1" : "/api/sync", { method: "POST" });
      const data = await response.json() as { status?: string; jobsAdded?: number; jobsUpdated?: number; jobsDeleted?: number; jobsQueued?: number; error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "同步失败");
      setNotice(data.status === "cancelled" ? `同步已取消，已保存的数据保留：新增 ${data.jobsAdded}，更新 ${data.jobsUpdated}` : `同步完成：新增 ${data.jobsAdded}，更新 ${data.jobsUpdated}，清理 ${data.jobsDeleted}，待审核 ${data.jobsQueued ?? 0}`);
      await latestLoad.current();
    } catch (e) { setNotice(e instanceof Error ? e.message : "同步失败"); }
    finally { setSyncing(false); }
  }

  async function cancelSync() {
    const runId = progress?.run?.id;
    if (!runId || !runActive || isCancelling) return;
    setCancelSending(true); setNotice("");
    try {
      const response = await fetch("/api/sync/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId }) });
      const data = await response.json() as { status?: string; error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "取消同步失败");
      setProgress(previous => previous?.run?.id === runId ? { ...previous, run: { ...previous.run, status: data.status || "cancelling" } } : previous);
      if (data.status !== "cancelling") setNotice(data.status === "cancelled" ? "同步已取消，已保存的数据保留" : "该同步任务已经结束");
    } catch (error) { setNotice(error instanceof Error ? error.message : "取消同步失败，请重试"); }
    finally { setCancelSending(false); }
  }

  return (
    <div className="min-h-screen bg-[#f5f5f0] text-[#172019] md:pl-[208px]">
      <Directory view={view} />
      <header className="sticky top-0 z-30 border-b border-[#dfe2d8] bg-[#f5f5f0]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[1500px] items-center justify-between px-5 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-[#173f2a] text-white shadow-sm"><Radar size={21} /></div>
            <div><div className="flex items-center gap-2"><span className="font-semibold tracking-[-.02em]">求职雷达</span><span className="hidden rounded-full bg-[#dff0bd] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#36531f] sm:inline">Live</span></div><p className="text-xs text-[#778077]">7 天职位情报中心</p></div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowSources(true)} className="icon-button" aria-label="管理来源"><Settings2 size={17} /><span className="hidden sm:inline">来源</span></button>
            <button onClick={syncNow} disabled={isSyncing || sources.length === 0} className="sync-button"><RefreshCw size={16} className={isSyncing ? "animate-spin" : ""} />{isSyncing ? "同步中" : "立即同步"}</button>
            {isSyncing && <button onClick={cancelSync} disabled={!runActive || isCancelling} aria-label={isCancelling ? "正在取消同步" : "取消同步"} title="取消本次同步，保留已保存的职位" className="flex items-center gap-1 rounded-xl border border-[#d9b9b0] px-3 py-2 text-sm text-[#984a3c] disabled:cursor-wait disabled:opacity-50"><X size={16} /><span className="hidden sm:inline">{isCancelling ? "正在取消…" : "取消同步"}</span></button>}
          </div>
        </div>
      </header>
      <Directory view={view} mobile />

      <main className="mx-auto max-w-[1500px] px-5 py-7 lg:px-8 lg:py-10">
        {(!!progress?.sources.length || isSyncing) && <SyncProgressPanel progress={progress} syncing={isSyncing} error={progressError} />}
        {notice && <div role="status" className="mb-4 flex items-center justify-between rounded-xl border border-[#c9d8ba] bg-[#eff7df] px-4 py-3 text-sm text-[#36531f]"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="关闭提示"><X size={15} /></button></div>}
        {view === "resumes" ? <ResumeManager /> : view === "sources" ? <SourcesPage sources={sources} onChanged={load} /> : view === "runs" ? <HistoryPanel active={!!runActive} status={progress?.run?.status} /> : view === "applications" ? <ApplicationTracker refreshKey={applicationRefresh} onOpen={setApplicationId} /> : <>
        <section className="mb-8 grid gap-5 xl:grid-cols-[1fr_410px]">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-[#55715e]"><span className="size-2 rounded-full bg-[#72a34b] shadow-[0_0_0_5px_#dff0bd]" />每小时自动更新</div>
            <h1 className="max-w-3xl text-[clamp(2rem,4vw,4rem)] font-semibold leading-[1.08] tracking-[-.05em]">所有机会，一页页发现。</h1>
            <p className="mt-5 max-w-xl text-sm leading-6 text-[#697169]">有发布日期的职位只抓纽约时间当天；没有发布日期时，每个来源取前 50 条并按首次发现时间保留 7 天。每页 50 条，点击查看 JD；点击「＋」跟踪申请。</p>
          </div>
          <div className="status-card">
            <div className="flex items-start justify-between"><div><p className="eyebrow">系统状态</p><h2 className="mt-1 text-xl font-semibold">雷达正常运行</h2></div><div className="grid size-12 place-items-center rounded-full bg-[#dff0bd] text-[#2e591f]"><Zap size={20} fill="currentColor" /></div></div>
            <div className="mt-8 grid grid-cols-2 gap-3 text-sm"><div className="status-cell"><Clock3 size={15} /><span>上次同步</span><strong>{relativeTime(latestRun?.started_at)}</strong></div><div className="status-cell"><Globe2 size={15} /><span>监控来源</span><strong>{sources.length} 个</strong></div></div>
            <div className="mt-4 flex items-center gap-2 text-xs text-[#6f776f]"><Check size={14} className="text-[#568439]" />重复职位自动合并 · 满 7 天自动删除</div>
          </div>
        </section>

        <AiFilterPanel active={!!isSyncing} onReview={() => startSync(true)} />
        <section className="mb-6 grid grid-cols-3 overflow-hidden rounded-2xl border border-[#dfe2d8] bg-white/70">
          <Metric icon={<Layers3 />} value={stats.total ?? 0} label="当前职位" />
          <Metric icon={<Sparkles />} value={stats.new_today ?? 0} label="今日发布 · 纽约时间" />
          <Metric icon={<Building2 />} value={stats.companies ?? 0} label="活跃公司" />
        </section>

        <section className="mb-5 rounded-2xl border border-[#dfe2d8] bg-white p-3 shadow-[0_8px_30px_rgba(25,45,30,.04)]">
          <div className="grid gap-2 md:grid-cols-[1fr_260px_190px]">
            <label className="filter-field"><Search size={17} /><input aria-label="搜索职位" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="搜索所有页的公司、职位或技能…" /></label>
            <label className="filter-field"><MapPin size={17} /><input value={location} onChange={(e) => { setLocation(e.target.value); setPage(1); }} placeholder="地点，例如 New York" /></label>
            <label className="filter-field"><Database size={17} /><select value={mode} onChange={(e) => { setMode(e.target.value); setPage(1); }}><option>全部方式</option><option>Remote</option><option>Full-time</option><option>Part-time</option></select></label>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="filter-field"><Layers3 size={17} /><select aria-label="岗位分类" value={category} onChange={e => { setCategory(e.target.value); setPage(1); }}><option value="">全部岗位分类</option>{Object.entries(jobCategories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="filter-field"><Sparkles size={17} /><select aria-label="职业级别" value={level} onChange={e => { setLevel(e.target.value); setPage(1); }}><option value="">全部初级类别</option>{Object.entries(careerLevels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_330px]">
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-[#717971]">共 <strong className="text-[#172019]">{pages.total}</strong> 个职位 · 第 {pages.page} / {pages.totalPages} 页</p><p className="text-xs text-[#8a9089]">每页 50 条 · 按发布时间排序</p></div>
            <PaginationControls pages={pages} disabled={loading} onChange={setPage} />
            {loading ? <LoadingCards /> : filtered.length ? <div className="space-y-3">{filtered.map((job) => <JobCard key={job.id} job={job} adding={addingJobs.has(job.id)} onAdd={() => addApplication(job)} onClick={() => setSelected(job)} />)}</div> : <EmptyState hasSources={sources.length > 0} onAdd={() => setShowSources(true)} onSync={syncNow} />}
            <PaginationControls pages={pages} disabled={loading} onChange={setPage} />
          </section>
          <aside className="hidden space-y-4 xl:block">
            <div className="rounded-2xl bg-[#173f2a] p-6 text-white"><p className="eyebrow !text-[#b8d0bf]">去重逻辑</p><h3 className="mt-2 text-lg font-semibold">三道防线，一份结果</h3><div className="mt-5 space-y-4"><Rule n="01" title="来源职位 ID" text="同一 ATS 内的稳定主键" /><Rule n="02" title="规范化 URL" text="移除跟踪参数后全局比对" /><Rule n="03" title="内容指纹" text="公司、标题、地点与团队哈希" /></div></div>
            <div className="rounded-2xl border border-[#dfe2d8] bg-[#e9e7db] p-6"><p className="eyebrow">数据保留</p><p className="mt-3 text-3xl font-semibold tracking-[-.04em]">7 × 24h</p><p className="mt-2 text-sm leading-6 text-[#687068]">已知发布日期按发布日保留；日期未知取前 50 条，按首次发现时间保留。重复抓取不会重置期限，未知日期不计入今日发布。</p></div>
          </aside>
        </div>
        </>}
      </main>

      {selected && <JobDetail job={selected} onClose={() => setSelected(null)} />}
      {applicationId !== null && <ApplicationEditor key={applicationId} id={applicationId} onClose={() => setApplicationId(null)} onChanged={(removed) => { setApplicationRefresh(n => n+1); if (removed) setNotice("申请记录已移除"); latestLoad.current().catch(e => setNotice(e.message)); }} />}
      {showSources && <SourceManager sources={sources} onClose={() => setShowSources(false)} onChanged={load} onSync={syncNow} />}
    </div>
  );
}

function Directory({ view, mobile = false }: { view: View; mobile?: boolean }) {
  const links = [
    { view: "jobs", href: "/", label: "全部职位", icon: <Layers3 size={18} /> },
    { view: "applications", href: "/applications", label: "申请职位状态", icon: <ClipboardList size={18} /> },
    { view: "resumes", href: "/resumes", label: "简历管理", icon: <FileText size={18} /> },
    { view: "sources", href: "/sources", label: "招聘来源", icon: <Globe2 size={18} /> },
    { view: "runs", href: "/runs", label: "同步记录", icon: <Clock3 size={18} /> },
  ];
  return <aside className={mobile ? "border-b border-[#dfe2d8] bg-[#edf0e6] px-3 py-2 md:hidden" : "fixed inset-y-0 left-0 z-40 hidden w-[208px] flex-col border-r border-[#d8ddcf] bg-[#edf0e6] p-5 md:flex"}>
    {!mobile && <><a href="/" className="mb-10 mt-2 flex items-center gap-2 font-semibold text-[#173f2a]"><Radar size={24} />求职雷达</a><p className="eyebrow mb-4">工作空间</p></>}
    {/* Native links avoid the local Vinext client router's failing navigation callback. */}
    <nav aria-label="主目录" className={mobile ? "grid grid-cols-5 gap-1" : "space-y-2"}>{links.map(link => <a key={link.view} href={link.href} aria-current={view === link.view ? "page" : undefined} className={`flex rounded-xl text-sm transition ${mobile ? "flex-col items-center justify-center gap-1 px-1 py-2 text-center text-xs" : "items-center gap-2 px-3 py-3"} ${view === link.view ? "bg-[#173f2a] font-semibold text-white shadow-sm" : "text-[#61705e] hover:bg-white"}`}>{link.icon}<span>{link.label}</span></a>)}</nav>
    {!mobile && <div className="mt-auto rounded-2xl border border-[#d8ddcf] bg-white/70 p-4 text-xs leading-6 text-[#6c7866]">每天的新机会<br /><strong className="text-[#294c31]">已知日期抓当天<br />未知日期前 50 条</strong><br />保留 7 天 · 纽约日期</div>}
  </aside>;
}

function PaginationControls({ pages, disabled = false, onChange }: { pages: Pages; disabled?: boolean; onChange: (page: number) => void }) {
  const [jump, setJump] = useState(String(pages.page));
  useEffect(() => setJump(String(pages.page)), [pages.page]);
  const numbers = [...new Set([1, pages.totalPages, ...Array.from({ length: 5 }, (_, i) => pages.page + i - 2)])].filter(n => n >= 1 && n <= pages.totalPages).sort((a,b)=>a-b);
  return <nav aria-label="分页" className="my-4 flex flex-wrap items-center gap-2 rounded-xl border border-[#dfe2d8] bg-white p-3 text-sm">
    <button className="icon-button" disabled={disabled || pages.page <= 1} onClick={() => onChange(pages.page-1)}>上一页</button>
    {numbers.map((n,i) => <span key={n} className="flex items-center gap-2">{i>0 && n>numbers[i-1]+1 && <span className="text-[#889180]">…</span>}<button aria-label={`前往第 ${n} 页`} aria-current={n===pages.page ? "page" : undefined} disabled={disabled} onClick={() => onChange(n)} className={`grid size-9 place-items-center rounded-lg ${n===pages.page ? "bg-[#173f2a] font-semibold text-white" : "hover:bg-[#edf0e6]"}`}>{n}</button></span>)}
    <button className="icon-button" disabled={disabled || pages.page >= pages.totalPages} onClick={() => onChange(pages.page+1)}>下一页</button>
    <form className="ml-auto flex items-center gap-2" onSubmit={e=>{ e.preventDefault(); const n=Number(jump); if(Number.isSafeInteger(n)&&n>=1&&n<=pages.totalPages)onChange(n); }}><label className="text-xs text-[#697563]">跳至 <input aria-label="跳转页码" className="mx-1 w-16 rounded-lg border border-[#dfe2d8] px-2 py-2 text-center" type="number" min={1} max={pages.totalPages} value={jump} onChange={e=>setJump(e.target.value)} /> 页</label><button disabled={disabled} className="icon-button">跳转</button></form>
  </nav>;
}

function HistoryPanel({ active, status }: { active: boolean; status?: string }) {
  type HistoryRun = { id: number; status: string; started_at: string; finished_at?: string; sources_total: number; sources_succeeded: number; jobs_seen: number; jobs_added: number; jobs_updated: number; jobs_deleted: number; error_summary?: string };
  const [runs,setRuns]=useState<HistoryRun[]>([]),[page,setPage]=useState(1),[error,setError]=useState("");
  const [pages,setPages]=useState<Pages>({page:1,pageSize:20,total:0,totalPages:1});
  useEffect(()=>{
    let ignore=false, inFlight=false;
    const read=async()=>{if(inFlight)return;inFlight=true;try{const r=await fetch(`/api/sync/runs?page=${page}`,{cache:"no-store"});const d=await r.json() as {runs:HistoryRun[];pagination:Pages;error?:string};if(!r.ok)throw new Error(d.error);if(!ignore){setRuns(d.runs);setPages(d.pagination);setError("");}}catch(e){if(!ignore)setError(e instanceof Error?e.message:"读取失败");}finally{inFlight=false;}};
    read(); const timer=active?setInterval(read,5000):undefined;
    return()=>{ignore=true;clearInterval(timer);};
  },[page,active,status]);
  const labels:Record<string,string>={running:"同步中",cancelling:"正在取消",cancelled:"已取消",success:"成功",partial:"部分完成",failed:"失败"};
  return <section><p className="eyebrow">Sync history</p><h1 className="mt-2 text-3xl font-semibold">同步记录</h1><p className="my-4 text-sm text-[#6c7866]">查看每轮抓取结果、耗时和错误。{active&&"同步中自动刷新。"}</p>{error&&<p role="alert" className="mb-4 text-red-700">{error}</p>}
    <div className="overflow-x-auto rounded-2xl border border-[#dfe2d8] bg-white"><table className="w-full text-left text-sm"><thead className="bg-[#edf0e6] text-[#687661]"><tr>{["任务 / 开始时间","状态","来源","新增 / 更新","清理","耗时 / 详情"].map(h=><th key={h} className="whitespace-nowrap px-4 py-3 font-medium">{h}</th>)}</tr></thead><tbody>{runs.map(run=><tr key={run.id} className="border-t border-[#e7eadd]"><td className="px-4 py-4"><strong>#{run.id}</strong><p className="mt-1 whitespace-nowrap text-xs text-[#7a8474]">{new Date(run.started_at).toLocaleString("zh-CN",{timeZone:"America/New_York"})}</p></td><td className="px-4 py-4">{labels[run.status]||run.status}</td><td className="px-4 py-4">{run.sources_succeeded}/{run.sources_total}</td><td className="px-4 py-4">{run.jobs_added} / {run.jobs_updated}</td><td className="px-4 py-4">{run.jobs_deleted}</td><td className="max-w-sm px-4 py-4">{run.finished_at?`${Math.max(0,Math.round((Date.parse(run.finished_at)-Date.parse(run.started_at))/1000))} 秒`:"进行中"}{run.error_summary&&<details className="mt-1 text-xs text-red-700"><summary className="cursor-pointer">查看错误</summary><p className="mt-2 whitespace-pre-wrap break-words">{run.error_summary}</p></details>}</td></tr>)}</tbody></table>{!runs.length&&!error&&<p className="p-8 text-center text-[#7a8474]">暂无同步记录</p>}</div><PaginationControls pages={pages} onChange={setPage}/><p className="text-xs text-[#87917e]">开始时间统一显示为纽约时间。</p></section>;
}

function SourcesPage({ sources, onChanged }: { sources: Source[]; onChanged: () => Promise<void> }) {
  const [name,setName]=useState(""),[url,setUrl]=useState(""),[search,setSearch]=useState(""),[error,setError]=useState(""),[saving,setSaving]=useState(false);
  const [validating,setValidating]=useState<number|null>(null);
  async function verify(id:number){setValidating(id);setError("");try{const r=await fetch(`/api/sources/${id}`,{method:"POST"});const d=await r.json() as {error?:string};if(!r.ok)throw new Error(d.error||"验证失败");}catch(e){setError(e instanceof Error?e.message:"验证失败");}finally{await onChanged();setValidating(null);}}
  async function add(e:FormEvent){e.preventDefault();setSaving(true);setError("");try{const r=await fetch("/api/sources",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name,url,adapter:"auto"})});const d=await r.json() as {error?:string};if(!r.ok)throw new Error(d.error);setName("");setUrl("");await onChanged();}catch(e){setError(e instanceof Error?e.message:"添加失败");}finally{setSaving(false);}}
  async function remove(id:number){try{const r=await fetch(`/api/sources/${id}`,{method:"DELETE"});if(!r.ok)throw new Error("删除来源失败");await onChanged();}catch(e){setError(e instanceof Error?e.message:"删除失败");}}
  const visible=sources.filter(s=>`${s.name} ${s.url}`.toLowerCase().includes(search.toLowerCase()));
  return <section><p className="eyebrow">Source directory</p><h1 className="mt-2 text-3xl font-semibold">招聘来源</h1><p className="my-4 text-sm text-[#6c7866]">已启用 {sources.filter(s=>s.enabled).length} / {sources.length} 个来源 · 抓取当天职位，日期未知时取前 50 条。验证来源不会调用模型。</p>
    <form onSubmit={add} className="mb-6 grid gap-3 rounded-2xl border border-[#dfe2d8] bg-white p-4 sm:grid-cols-[1fr_2fr_auto]"><input aria-label="公司名称" required value={name} onChange={e=>setName(e.target.value)} className="source-input" placeholder="公司名称"/><input aria-label="招聘页地址" required type="url" value={url} onChange={e=>setUrl(e.target.value)} className="source-input" placeholder="招聘页 URL"/><button disabled={saving} className="sync-button justify-center"><Plus size={16}/>{saving?"添加中":"添加来源"}</button></form>
    {error&&<p role="alert" className="mb-4 text-red-700">{error}</p>}<label className="filter-field mb-5"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索招聘来源…"/></label>
    <div className="grid gap-3 xl:grid-cols-2">{visible.map(s=><article key={s.id} className="flex items-start gap-3 rounded-2xl border border-[#dfe2d8] bg-white p-5"><Globe2 size={20} className="mt-1 shrink-0 text-[#6f8461]"/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{s.name}</h2><span className="tag">{adapterName[s.adapter]||s.adapter}</span><span className="tag">{s.enabled?"已启用":"未启用"}</span></div><a href={s.url} target="_blank" rel="noreferrer" className="mt-2 block truncate text-xs text-[#73816a] hover:underline">{s.url}</a><p className="mt-2 text-xs text-[#73816a]">{s.job_count} 条保留职位 · {relativeTime(s.last_success_at)}</p>{s.last_error&&<p className="mt-2 break-words text-xs text-amber-800">{s.last_error}</p>}</div><div className="flex shrink-0 flex-col items-center gap-2">{!["Greenhouse","Ashby","Lever","Workday","Workable"].includes(s.name)&&<button onClick={()=>verify(s.id)} disabled={validating!==null} aria-label={`验证 ${s.name}`} className="rounded-lg border border-[#dfe2d8] px-2 py-1 text-xs text-[#456d38] disabled:opacity-50">{validating===s.id?"验证中…":"验证"}</button>}<button onClick={()=>remove(s.id)} disabled={validating===s.id} aria-label={`删除 ${s.name}`} className="round-button text-[#965b50]"><Trash2 size={15}/></button></div></article>)}</div>{!visible.length&&<p className="p-8 text-center text-[#73816a]">没有匹配的来源</p>}</section>;
}

function SyncProgressPanel({ progress, syncing, error }: { progress: SyncProgress | null; syncing: boolean; error: string }) {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    if (!syncing) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [syncing]);
  const rows = progress?.sources ?? [];
  const active = rows.filter((row) => row.stage === "fetching" || row.stage === "saving" || row.stage === "classifying");
  const finished = rows.filter((row) => row.stage === "success" || row.stage === "failed" || row.stage === "partial" || row.stage === "deferred");
  const failed = rows.filter((row) => row.stage === "failed" || row.stage === "partial").length;
  const total = progress?.run?.sources_total ?? 0;
  const percent = total ? Math.round(finished.length / total * 100) : 0;
  const sum = (key: "jobs_total" | "jobs_added" | "jobs_updated" | "jobs_ignored") => rows.reduce((value, row) => value + row[key], 0);
  const elapsed = (start: string | null | undefined, end?: string | null) => {
    if (!start) return "—";
    const seconds = Math.max(0, Math.floor(((end ? Date.parse(end) : clock) - Date.parse(start)) / 1000));
    return seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`;
  };
  const stages: Record<string, string> = { queued: "等待中", fetching: "抓取职位列表 / 详情", saving: "去重并写入数据库", classifying: "预筛、缓存检查 / AI 审核", deferred: "今日额度用完，剩余候选已排队", success: "完成", partial: "部分完成", failed: "失败", cancelled: "已取消" };
  function sourceRow(row: SourceProgress) {
    const slow = row.stage === "fetching" && row.started_at && clock - Date.parse(row.started_at) > 60000;
    return <li key={row.source_id} className="border-t border-[#e2e6dc] py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><a href={row.url} target="_blank" rel="noreferrer" className="font-medium underline-offset-4 hover:underline">{row.name} ↗</a><span className={row.stage === "failed" ? "text-red-700" : "text-[#64745e]"}>{stages[row.stage]} · {elapsed(row.started_at, row.finished_at)}</span></div>
      <p className="mt-1 text-xs text-[#6f776f]">{row.stage === "saving" || row.stage === "classifying" ? `已处理 ${row.jobs_processed} / ${row.jobs_total} 条 · ` : row.stage === "success" ? `扫描 ${row.jobs_total} 条 · ` : ""}{row.stage !== "queued" && row.stage !== "fetching" && `新增 ${row.jobs_added} · 更新 ${row.jobs_updated} · 跳过 ${row.jobs_ignored} · 待审核 ${row.jobs_queued ?? 0}`}</p>
      {slow && <p className="mt-1 text-xs text-amber-800">抓取已超过 60 秒，正在等待该来源的列表或详情请求返回。</p>}
      {row.error && <p className={`mt-1 break-words text-xs ${row.stage === "success" ? "text-[#718064]" : "text-red-700"}`}>{row.error}</p>}
    </li>;
  }
  return <section className="mb-7 rounded-2xl border border-[#cbd8bf] bg-white p-5 shadow-sm" aria-label="同步进度">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-semibold"><RefreshCw size={17} className={syncing ? "animate-spin" : ""} />{progress?.run?.status === "cancelled" ? "同步已取消" : progress?.run?.status === "cancelling" ? "正在取消同步…" : syncing ? "正在同步招聘信息" : failed ? "同步结束，部分来源失败" : "最近一次同步已完成"}</h2><span className="text-sm tabular-nums text-[#64745e]">{finished.length} / {total} 个来源 · {percent}% · 耗时 {elapsed(progress?.run?.started_at, progress?.run?.finished_at)}</span></div>
    {progress?.run?.status === "cancelled" && <p className="mt-3 text-sm text-[#64745e]">已停止抓取。已入库的职位保留，可点击“立即同步”重新开始。取消的来源不计入失败。</p>}
    {progress?.run?.status === "cancelling" && <p role="status" className="mt-3 text-sm text-[#64745e]">正在中止网络请求并保存当前进度，请稍候…</p>}
    <div className="my-4 h-2 overflow-hidden rounded-full bg-[#edf0e8]" role="progressbar" aria-label="已完成来源比例" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-[#527c3d] transition-all" style={{ width: `${percent}%` }} /></div>
    <p className="text-sm text-[#64745e]" aria-live="polite">已解析 {sum("jobs_total")} 条 · 新增 {sum("jobs_added")} · 更新 {sum("jobs_updated")} · 跳过 {sum("jobs_ignored")} · 清理 {progress?.run?.jobs_deleted ?? 0} · 失败 {failed}</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">进度暂时无法刷新：{error}。正在重试，下方为最后一次读取结果。</p>}
    {syncing && !active.length && <p className="mt-3 text-sm text-[#64745e]">正在准备同步或汇总结果…</p>}
    {active.length > 0 && <ul className="mt-3">{active.map(sourceRow)}</ul>}
    {rows.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-sm text-[#4b6b3d]">查看全部来源（含等待、耗时和失败原因）</summary><ul className="mt-2 max-h-96 overflow-y-auto">{rows.map(sourceRow)}</ul></details>}
    <p className="mt-3 text-xs text-[#858c80]">已知发布日期只抓纽约当天；未知日期每个来源前 50 条。先粗筛、去重和复用缓存；每日 AI 额度可自行设置，超额候选排队，正式职位与候选均保留 7 天。</p>
  </section>;
}

function Metric({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return <div className="flex items-center gap-3 border-r border-[#dfe2d8] px-4 py-5 last:border-0 sm:px-6"><span className="hidden text-[#6a806c] sm:block [&>svg]:size-[18px]">{icon}</span><div><strong className="text-2xl tracking-[-.04em]">{value}</strong><p className="text-xs text-[#747c74]">{label}</p></div></div>;
}

function JobCard({ job, onClick, onAdd, adding }: { job: Job; onClick: () => void; onAdd: () => void; adding: boolean }) {
  return <article className="job-card group flex items-start gap-3">
    <button onClick={onClick} className="min-w-0 flex-1 text-left" aria-label={`查看 ${job.company} 的 ${job.title}`}>
      <div className="flex gap-4"><div className="company-mark">{job.company.slice(0, 2).toUpperCase()}</div><div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium text-[#6b756c]">{job.company}</p><h3 className="mt-1 text-[17px] font-semibold tracking-[-.02em] text-[#172019] group-hover:text-[#2e633e]">{job.title}</h3></div><ChevronRight className="mt-2 shrink-0 text-[#a4aaa4]" size={19} /></div>
        <ClassificationTags analysis={job.classification} />
        {!job.publication_verified && <span className="tag mt-2 !bg-[#fff4df] !text-[#85602d]">发布日期未知 · 按首次发现保留</span>}
        <div className="mt-4 flex flex-wrap gap-2"><Tag icon={<MapPin />} text={job.location} />{job.workplace_type && <Tag text={job.workplace_type} />}{job.employment_type && <Tag text={job.employment_type} />}{job.salary && <Tag text={job.salary} />}</div>
        <div className="mt-4 flex items-center justify-between text-xs text-[#858b85]"><span>{job.department || job.source_name}</span><span>{job.publication_verified ? relativeTime(job.posted_at) : `首次发现 ${relativeTime(job.first_seen_at)}`}</span></div>
      </div></div>
    </button>
    <button onClick={onAdd} disabled={adding} aria-label={job.application_id ? `编辑 ${job.title} 的申请记录` : `将 ${job.title} 加入申请职位状态`} title={job.application_id ? "已加入，点击编辑申请记录" : "加入申请职位状态"} className="grid size-10 shrink-0 place-items-center rounded-xl border border-[#cddac3] bg-[#edf4e6] text-[#365b3c] transition hover:bg-[#dcebcf] disabled:opacity-50">{adding ? <RefreshCw size={17} className="animate-spin" /> : job.application_id ? <Check size={18} /> : <Plus size={18} />}</button>
  </article>;
}

function Tag({ icon, text }: { icon?: ReactNode; text: string }) { return <span className="tag">{icon && <span className="[&>svg]:size-3">{icon}</span>}{text}</span>; }
function Rule({ n, title, text }: { n: string; title: string; text: string }) { return <div className="flex gap-3"><span className="font-mono text-xs text-[#95b69e]">{n}</span><div><strong className="text-sm font-medium">{title}</strong><p className="text-xs text-[#a9bdb0]">{text}</p></div></div>; }

function EmptyState({ hasSources, onAdd, onSync }: { hasSources: boolean; onAdd: () => void; onSync: () => void }) {
  return <div className="rounded-3xl border border-dashed border-[#cbd0c7] bg-white/60 px-6 py-20 text-center"><div className="mx-auto grid size-16 place-items-center rounded-2xl bg-[#e7eedc] text-[#456d38]"><Radar size={28} /></div><h3 className="mt-5 text-xl font-semibold">{hasSources ? "没有符合当前条件的职位" : "添加你的第一个招聘来源"}</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#737b73]">{hasSources ? "试试调整搜索条件，或同步当天新发布的职位。" : "支持 Greenhouse、Lever、Ashby，以及包含 JobPosting JSON-LD 的招聘网页。"}</p><button onClick={hasSources ? onSync : onAdd} className="mt-6 sync-button"><Plus size={16} />{hasSources ? "立即同步" : "添加来源"}</button></div>;
}

function LoadingCards() { return <div className="space-y-3">{[1,2,3].map((n) => <div key={n} className="h-40 animate-pulse rounded-2xl border border-[#e1e4dc] bg-white/70" />)}</div>; }

function JobDetail({ job, onClose }: { job: Job; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex justify-end bg-[#102016]/30 backdrop-blur-[2px]" onMouseDown={onClose}>
    <article onMouseDown={e => e.stopPropagation()} className="h-full w-full max-w-2xl overflow-y-auto bg-[#fbfbf7] p-6 shadow-2xl sm:p-9">
      <div className="flex items-center justify-between"><span className="tag">{job.source_name}</span><button onClick={onClose} aria-label="关闭职位详情" className="round-button"><X size={18} /></button></div>
      <div className="mt-10 flex gap-5"><div className="company-mark !size-14 !rounded-2xl">{job.company.slice(0,2).toUpperCase()}</div><div><p className="text-sm text-[#6f786f]">{job.company}</p><h2 className="mt-1 text-3xl font-semibold leading-tight tracking-[-.04em]">{job.title}</h2></div></div>
      <ClassificationTags analysis={job.classification} />
      <div className="mt-6 flex flex-wrap gap-2"><Tag icon={<MapPin />} text={job.location} />{job.workplace_type && <Tag text={job.workplace_type} />}{job.employment_type && <Tag text={job.employment_type} />}{job.department && <Tag text={job.department} />}</div>
      <JobAnalysisPanel analysis={job.classification} />
      <div className="my-8 h-px bg-[#dfe2d8]" /><div className="flex items-center justify-between"><h3 className="font-semibold">职位描述</h3><span className="text-xs text-[#7e857e]">{job.publication_verified ? "发布于 " : "发布日期未知 · 首次发现于 "}{new Date(job.publication_verified ? job.posted_at : job.first_seen_at).toLocaleDateString("zh-CN")}</span></div>
      <div className="jd mt-5 whitespace-pre-wrap text-sm leading-7 text-[#434b44]">{job.description || "该来源没有提供完整职位描述，请前往原始页面查看。"}</div>
      <a href={job.apply_url || job.canonical_url} target="_blank" rel="noreferrer" className="mt-10 flex w-full items-center justify-center gap-2 rounded-xl bg-[#173f2a] px-5 py-4 font-medium text-white transition hover:bg-[#24563a]">前往申请 <ArrowUpRight size={17} /></a>
    </article>
  </div>;
}

function SourceManager({ sources, onClose, onChanged, onSync }: { sources: Source[]; onClose: () => void; onChanged: () => Promise<void>; onSync: () => void }) {
  const [name, setName] = useState(""); const [url, setUrl] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function add(e: FormEvent) { e.preventDefault(); setSaving(true); setError(""); try { const r = await fetch("/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, url, adapter: "auto" }) }); const d = await r.json() as { error?: string }; if (!r.ok) throw new Error(d.error || "添加失败"); setName(""); setUrl(""); await onChanged(); } catch (e) { setError(e instanceof Error ? e.message : "添加失败"); } finally { setSaving(false); } }
  async function remove(id: number) { await fetch(`/api/sources/${id}`, { method: "DELETE" }); await onChanged(); }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#102016]/35 p-4 backdrop-blur-[2px]" onMouseDown={onClose}><section onMouseDown={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-[#fbfbf7] p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between"><div><p className="eyebrow">Source Manager</p><h2 className="mt-1 text-2xl font-semibold tracking-[-.03em]">管理招聘来源</h2><p className="mt-1 text-sm text-[#737b73]">粘贴公司的招聘看板 URL，系统会自动识别适配器。</p></div><button onClick={onClose} className="round-button"><X size={18} /></button></div><form onSubmit={add} className="mt-7 grid gap-3 rounded-2xl bg-[#eef0e8] p-4 sm:grid-cols-[180px_1fr_auto]"><input required value={name} onChange={(e) => setName(e.target.value)} className="source-input" placeholder="公司名称" /><input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} className="source-input" placeholder="https://jobs.ashbyhq.com/company" /><button disabled={saving} className="sync-button justify-center"><Plus size={16} />{saving ? "添加中" : "添加"}</button></form>{error && <p className="mt-2 text-sm text-red-700">{error}</p>}<div className="mt-6 space-y-3">{sources.length ? sources.map((source) => <div key={source.id} className="flex items-center gap-4 rounded-2xl border border-[#dfe2d8] bg-white p-4"><div className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#e5eadf] text-[#4b674e]"><Globe2 size={19} /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="text-sm">{source.name}</strong><span className="tag !py-0.5">{adapterName[source.adapter] || source.adapter}</span></div><p className="mt-1 truncate text-xs text-[#7b827b]">{source.url}</p><p className={`mt-1 text-xs ${source.last_error ? "text-red-700" : "text-[#66805e]"}`}>{source.last_error ? `错误：${source.last_error}` : `${source.job_count ?? 0} 个职位 · ${relativeTime(source.last_success_at)}`}</p></div><button onClick={() => remove(source.id)} className="round-button text-[#8a5b55]" aria-label="删除来源"><Trash2 size={16} /></button></div>) : <div className="py-10 text-center text-sm text-[#7c847c]">还没有来源。支持 Greenhouse、Lever、Ashby 和通用招聘网页。</div>}</div>{sources.length > 0 && <div className="mt-6 flex justify-end"><button onClick={() => { onClose(); onSync(); }} className="sync-button"><RefreshCw size={16} />保存并同步</button></div>}</section></div>;
}
