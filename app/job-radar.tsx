"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowUpRight, Building2, Check, ChevronRight, Clock3, Database, ExternalLink,
  Globe2, Layers3, MapPin, Plus, Radar, RefreshCw, Search, Settings2, Sparkles,
  Trash2, X, Zap,
} from "lucide-react";

type Job = {
  id: number; company: string; title: string; location: string; workplace_type?: string;
  employment_type?: string; department?: string; salary?: string; description: string;
  posted_at: string; first_seen_at: string; apply_url: string; canonical_url: string; source_name: string;
};
type Source = { id: number; name: string; url: string; adapter: string; job_count: number; last_success_at?: string; last_error?: string };
type Stats = { total: number; companies: number; new_today: number };
type Run = { status: string; started_at: string; jobs_added: number; jobs_deleted: number } | null;

function relativeTime(date?: string) {
  if (!date) return "尚未同步";
  const hours = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 3_600_000));
  if (hours < 1) return "刚刚";
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

const adapterName: Record<string, string> = {
  greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", jsonld: "通用网页", auto: "自动识别",
};

export default function JobRadar() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, companies: 0, new_today: 0 });
  const [latestRun, setLatestRun] = useState<Run>(null);
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [mode, setMode] = useState("全部方式");
  const [selected, setSelected] = useState<Job | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const [jobResponse, sourceResponse] = await Promise.all([fetch("/api/jobs"), fetch("/api/sources")]);
    const jobData = await jobResponse.json() as { jobs?: Job[]; stats?: Stats; latestRun?: Run; error?: string };
    const sourceData = await sourceResponse.json() as { sources?: Source[]; error?: string };
    if (!jobResponse.ok) throw new Error(jobData.error || "职位读取失败");
    setJobs(jobData.jobs ?? []); setStats(jobData.stats ?? { total: 0, companies: 0, new_today: 0 }); setLatestRun(jobData.latestRun ?? null);
    setSources(sourceData.sources ?? []); setLoading(false);
  }, []);

  useEffect(() => { load().catch((e) => { setNotice(e.message); setLoading(false); }); }, [load]);

  const filtered = useMemo(() => jobs.filter((job) => {
    const haystack = `${job.title} ${job.company} ${job.description}`.toLowerCase();
    const matchesQuery = !query || haystack.includes(query.toLowerCase());
    const matchesLocation = !location || job.location.toLowerCase().includes(location.toLowerCase());
    const matchesMode = mode === "全部方式" || `${job.workplace_type} ${job.employment_type}`.toLowerCase().includes(mode.toLowerCase());
    return matchesQuery && matchesLocation && matchesMode;
  }), [jobs, query, location, mode]);

  async function syncNow() {
    setSyncing(true); setNotice("");
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      const data = await response.json() as { jobsAdded?: number; jobsUpdated?: number; jobsDeleted?: number; error?: string };
      if (!response.ok) throw new Error(data.error || "同步失败");
      setNotice(`同步完成：新增 ${data.jobsAdded}，更新 ${data.jobsUpdated}，清理 ${data.jobsDeleted}`);
      await load();
    } catch (e) { setNotice(e instanceof Error ? e.message : "同步失败"); }
    finally { setSyncing(false); }
  }

  return (
    <div className="min-h-screen bg-[#f5f5f0] text-[#172019]">
      <header className="sticky top-0 z-30 border-b border-[#dfe2d8] bg-[#f5f5f0]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[1500px] items-center justify-between px-5 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-[#173f2a] text-white shadow-sm"><Radar size={21} /></div>
            <div><div className="flex items-center gap-2"><span className="font-semibold tracking-[-.02em]">求职雷达</span><span className="rounded-full bg-[#dff0bd] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#36531f]">Live</span></div><p className="text-xs text-[#778077]">7 天职位情报中心</p></div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowSources(true)} className="icon-button" aria-label="管理来源"><Settings2 size={17} /><span className="hidden sm:inline">来源</span></button>
            <button onClick={syncNow} disabled={syncing || sources.length === 0} className="sync-button"><RefreshCw size={16} className={syncing ? "animate-spin" : ""} />{syncing ? "同步中" : "立即同步"}</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-5 py-7 lg:px-8 lg:py-10">
        <section className="mb-8 grid gap-5 xl:grid-cols-[1fr_410px]">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-[#55715e]"><span className="size-2 rounded-full bg-[#72a34b] shadow-[0_0_0_5px_#dff0bd]" />每小时自动更新</div>
            <h1 className="max-w-3xl text-[clamp(2.2rem,5vw,4.8rem)] font-semibold leading-[.98] tracking-[-.06em]">新机会，不该<br /><span className="text-[#6b795f]">淹没在标签页里。</span></h1>
            <p className="mt-5 max-w-xl text-sm leading-6 text-[#697169]">聚合你的目标公司招聘页，自动去重，只保留最近 7 天的有效职位。点击职位即可查看完整 JD。</p>
          </div>
          <div className="status-card">
            <div className="flex items-start justify-between"><div><p className="eyebrow">系统状态</p><h2 className="mt-1 text-xl font-semibold">雷达正常运行</h2></div><div className="grid size-12 place-items-center rounded-full bg-[#dff0bd] text-[#2e591f]"><Zap size={20} fill="currentColor" /></div></div>
            <div className="mt-8 grid grid-cols-2 gap-3 text-sm"><div className="status-cell"><Clock3 size={15} /><span>上次同步</span><strong>{relativeTime(latestRun?.started_at)}</strong></div><div className="status-cell"><Globe2 size={15} /><span>监控来源</span><strong>{sources.length} 个</strong></div></div>
            <div className="mt-4 flex items-center gap-2 text-xs text-[#6f776f]"><Check size={14} className="text-[#568439]" />重复职位自动合并 · 满 7 天自动删除</div>
          </div>
        </section>

        <section className="mb-6 grid grid-cols-3 overflow-hidden rounded-2xl border border-[#dfe2d8] bg-white/70">
          <Metric icon={<Layers3 />} value={stats.total ?? 0} label="当前职位" />
          <Metric icon={<Sparkles />} value={stats.new_today ?? 0} label="24 小时新增" />
          <Metric icon={<Building2 />} value={stats.companies ?? 0} label="活跃公司" />
        </section>

        <section className="mb-5 rounded-2xl border border-[#dfe2d8] bg-white p-3 shadow-[0_8px_30px_rgba(25,45,30,.04)]">
          <div className="grid gap-2 md:grid-cols-[1fr_260px_190px]">
            <label className="filter-field"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索公司、职位或技能…" /></label>
            <label className="filter-field"><MapPin size={17} /><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="地点，例如 New York" /></label>
            <label className="filter-field"><Database size={17} /><select value={mode} onChange={(e) => setMode(e.target.value)}><option>全部方式</option><option>Remote</option><option>Full-time</option><option>Part-time</option></select></label>
          </div>
        </section>

        {notice && <div className="mb-4 flex items-center justify-between rounded-xl border border-[#c9d8ba] bg-[#eff7df] px-4 py-3 text-sm text-[#36531f]"><span>{notice}</span><button onClick={() => setNotice("")}><X size={15} /></button></div>}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_330px]">
          <section>
            <div className="mb-3 flex items-center justify-between"><p className="text-sm text-[#717971]">显示 <strong className="text-[#172019]">{filtered.length}</strong> 个职位</p><p className="text-xs text-[#8a9089]">按发布时间排序</p></div>
            {loading ? <LoadingCards /> : filtered.length ? <div className="space-y-3">{filtered.map((job) => <JobCard key={job.id} job={job} onClick={() => setSelected(job)} />)}</div> : <EmptyState hasSources={sources.length > 0} onAdd={() => setShowSources(true)} onSync={syncNow} />}
          </section>
          <aside className="hidden space-y-4 xl:block">
            <div className="rounded-2xl bg-[#173f2a] p-6 text-white"><p className="eyebrow !text-[#b8d0bf]">去重逻辑</p><h3 className="mt-2 text-lg font-semibold">三道防线，一份结果</h3><div className="mt-5 space-y-4"><Rule n="01" title="来源职位 ID" text="同一 ATS 内的稳定主键" /><Rule n="02" title="规范化 URL" text="移除跟踪参数后全局比对" /><Rule n="03" title="内容指纹" text="公司、标题、地点与团队哈希" /></div></div>
            <div className="rounded-2xl border border-[#dfe2d8] bg-[#e9e7db] p-6"><p className="eyebrow">数据保留</p><p className="mt-3 text-3xl font-semibold tracking-[-.04em]">7 × 24h</p><p className="mt-2 text-sm leading-6 text-[#687068]">每次同步开始前，删除发布时间早于或等于 7 天的记录；没有日期时从首次发现时间计。</p></div>
          </aside>
        </div>
      </main>

      {selected && <JobDetail job={selected} onClose={() => setSelected(null)} />}
      {showSources && <SourceManager sources={sources} onClose={() => setShowSources(false)} onChanged={load} onSync={syncNow} />}
    </div>
  );
}

function Metric({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return <div className="flex items-center gap-3 border-r border-[#dfe2d8] px-4 py-5 last:border-0 sm:px-6"><span className="hidden text-[#6a806c] sm:block [&>svg]:size-[18px]">{icon}</span><div><strong className="text-2xl tracking-[-.04em]">{value}</strong><p className="text-xs text-[#747c74]">{label}</p></div></div>;
}

function JobCard({ job, onClick }: { job: Job; onClick: () => void }) {
  return <button onClick={onClick} className="job-card group w-full text-left"><div className="flex gap-4"><div className="company-mark">{job.company.slice(0, 2).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium text-[#6b756c]">{job.company}</p><h3 className="mt-1 text-[17px] font-semibold tracking-[-.02em] text-[#172019] group-hover:text-[#2e633e]">{job.title}</h3></div><ChevronRight className="mt-2 shrink-0 text-[#a4aaa4] transition group-hover:translate-x-1 group-hover:text-[#426e4e]" size={19} /></div><div className="mt-4 flex flex-wrap gap-2"><Tag icon={<MapPin />} text={job.location} />{job.workplace_type && <Tag text={job.workplace_type} />}{job.employment_type && <Tag text={job.employment_type} />}{job.salary && <Tag text={job.salary} />}</div><div className="mt-4 flex items-center justify-between text-xs text-[#858b85]"><span>{job.department || job.source_name}</span><span>{relativeTime(job.posted_at)}</span></div></div></div></button>;
}

function Tag({ icon, text }: { icon?: ReactNode; text: string }) { return <span className="tag">{icon && <span className="[&>svg]:size-3">{icon}</span>}{text}</span>; }
function Rule({ n, title, text }: { n: string; title: string; text: string }) { return <div className="flex gap-3"><span className="font-mono text-xs text-[#95b69e]">{n}</span><div><strong className="text-sm font-medium">{title}</strong><p className="text-xs text-[#a9bdb0]">{text}</p></div></div>; }

function EmptyState({ hasSources, onAdd, onSync }: { hasSources: boolean; onAdd: () => void; onSync: () => void }) {
  return <div className="rounded-3xl border border-dashed border-[#cbd0c7] bg-white/60 px-6 py-20 text-center"><div className="mx-auto grid size-16 place-items-center rounded-2xl bg-[#e7eedc] text-[#456d38]"><Radar size={28} /></div><h3 className="mt-5 text-xl font-semibold">{hasSources ? "暂时没有 7 天内的新职位" : "添加你的第一个招聘来源"}</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#737b73]">{hasSources ? "来源已经就绪。立即同步一次，或等待下一次每小时扫描。" : "支持 Greenhouse、Lever、Ashby，以及包含 JobPosting JSON-LD 的招聘网页。"}</p><button onClick={hasSources ? onSync : onAdd} className="mt-6 sync-button"><Plus size={16} />{hasSources ? "立即同步" : "添加来源"}</button></div>;
}

function LoadingCards() { return <div className="space-y-3">{[1,2,3].map((n) => <div key={n} className="h-40 animate-pulse rounded-2xl border border-[#e1e4dc] bg-white/70" />)}</div>; }

function JobDetail({ job, onClose }: { job: Job; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex justify-end bg-[#102016]/30 backdrop-blur-[2px]" onMouseDown={onClose}><article onMouseDown={(e) => e.stopPropagation()} className="h-full w-full max-w-2xl overflow-y-auto bg-[#fbfbf7] p-6 shadow-2xl sm:p-9"><div className="flex items-center justify-between"><span className="tag">{job.source_name}</span><button onClick={onClose} className="round-button"><X size={18} /></button></div><div className="mt-10 flex gap-5"><div className="company-mark !size-14 !rounded-2xl">{job.company.slice(0,2).toUpperCase()}</div><div><p className="text-sm text-[#6f786f]">{job.company}</p><h2 className="mt-1 text-3xl font-semibold leading-tight tracking-[-.04em]">{job.title}</h2></div></div><div className="mt-6 flex flex-wrap gap-2"><Tag icon={<MapPin />} text={job.location} />{job.workplace_type && <Tag text={job.workplace_type} />}{job.employment_type && <Tag text={job.employment_type} />}{job.department && <Tag text={job.department} />}</div><div className="my-8 h-px bg-[#dfe2d8]" /><div className="flex items-center justify-between"><h3 className="font-semibold">职位描述</h3><span className="text-xs text-[#7e857e]">发布于 {new Date(job.posted_at).toLocaleDateString("zh-CN")}</span></div><div className="jd mt-5 whitespace-pre-wrap text-sm leading-7 text-[#434b44]">{job.description || "该来源没有提供完整职位描述，请前往原始页面查看。"}</div><a href={job.apply_url || job.canonical_url} target="_blank" rel="noreferrer" className="mt-10 flex w-full items-center justify-center gap-2 rounded-xl bg-[#173f2a] px-5 py-4 font-medium text-white transition hover:bg-[#24563a]">前往申请 <ArrowUpRight size={17} /></a></article></div>;
}

function SourceManager({ sources, onClose, onChanged, onSync }: { sources: Source[]; onClose: () => void; onChanged: () => Promise<void>; onSync: () => void }) {
  const [name, setName] = useState(""); const [url, setUrl] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function add(e: FormEvent) { e.preventDefault(); setSaving(true); setError(""); try { const r = await fetch("/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, url, adapter: "auto" }) }); const d = await r.json() as { error?: string }; if (!r.ok) throw new Error(d.error || "添加失败"); setName(""); setUrl(""); await onChanged(); } catch (e) { setError(e instanceof Error ? e.message : "添加失败"); } finally { setSaving(false); } }
  async function remove(id: number) { await fetch(`/api/sources/${id}`, { method: "DELETE" }); await onChanged(); }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#102016]/35 p-4 backdrop-blur-[2px]" onMouseDown={onClose}><section onMouseDown={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-[#fbfbf7] p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between"><div><p className="eyebrow">Source Manager</p><h2 className="mt-1 text-2xl font-semibold tracking-[-.03em]">管理招聘来源</h2><p className="mt-1 text-sm text-[#737b73]">粘贴公司的招聘看板 URL，系统会自动识别适配器。</p></div><button onClick={onClose} className="round-button"><X size={18} /></button></div><form onSubmit={add} className="mt-7 grid gap-3 rounded-2xl bg-[#eef0e8] p-4 sm:grid-cols-[180px_1fr_auto]"><input required value={name} onChange={(e) => setName(e.target.value)} className="source-input" placeholder="公司名称" /><input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} className="source-input" placeholder="https://jobs.ashbyhq.com/company" /><button disabled={saving} className="sync-button justify-center"><Plus size={16} />{saving ? "添加中" : "添加"}</button></form>{error && <p className="mt-2 text-sm text-red-700">{error}</p>}<div className="mt-6 space-y-3">{sources.length ? sources.map((source) => <div key={source.id} className="flex items-center gap-4 rounded-2xl border border-[#dfe2d8] bg-white p-4"><div className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#e5eadf] text-[#4b674e]"><Globe2 size={19} /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="text-sm">{source.name}</strong><span className="tag !py-0.5">{adapterName[source.adapter] || source.adapter}</span></div><p className="mt-1 truncate text-xs text-[#7b827b]">{source.url}</p><p className={`mt-1 text-xs ${source.last_error ? "text-red-700" : "text-[#66805e]"}`}>{source.last_error ? `错误：${source.last_error}` : `${source.job_count ?? 0} 个职位 · ${relativeTime(source.last_success_at)}`}</p></div><button onClick={() => remove(source.id)} className="round-button text-[#8a5b55]" aria-label="删除来源"><Trash2 size={16} /></button></div>) : <div className="py-10 text-center text-sm text-[#7c847c]">还没有来源。支持 Greenhouse、Lever、Ashby 和通用招聘网页。</div>}</div>{sources.length > 0 && <div className="mt-6 flex justify-end"><button onClick={() => { onClose(); onSync(); }} className="sync-button"><RefreshCw size={16} />保存并同步</button></div>}</section></div>;
}
