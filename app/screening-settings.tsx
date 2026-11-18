"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CoarseFilter, ScreeningRules } from "@/lib/screening-defaults";
import type { ScreeningSettings } from "@/lib/screening-settings";

const switches: [keyof CoarseFilter, string][] = [
  ["rejectSeniorTitles", "提前排除 Senior / Staff / 管理岗位"],
  ["rejectForeignLocations", "提前排除明确位于中国、美国以外的岗位"],
  ["rejectNonTechnical", "提前排除明确非技术岗位"],
  ["requireTechnicalSignals", "要求发现相关技术职责线索"],
  ["requireEarlyCareerSignals", "要求发现实习 / 应届 / 初级线索"],
];
const wordFields = [
  ["requiredKeywords", "必须包含的关键词", "标题或 JD 至少包含其中一个；留空不限制"],
  ["excludedKeywords", "排除关键词", "标题或 JD 包含任意一个即在粗筛拒绝"],
  ["extraTechnicalKeywords", "额外相关技术关键词", "补充内置的软件、AI、数据、量化等技术线索"],
] as const;
type Words = Record<typeof wordFields[number][0], string>;
const wordsFrom = (coarse: CoarseFilter): Words => Object.fromEntries(wordFields.map(([key]) => [key, coarse[key].join("\n")])) as Words;
export default function ScreeningSettingsEditor({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<ScreeningSettings | null>(null), [defaults, setDefaults] = useState<ScreeningRules | null>(null);
  const [coarse, setCoarse] = useState<CoarseFilter | null>(null), [prompt, setPrompt] = useState(""), [years, setYears] = useState("2");
  const [words, setWords] = useState<Words>({ requiredKeywords: "", excludedKeywords: "", extraTechnicalKeywords: "" });
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [dirty, setDirty] = useState(false);
  const [reload, setReload] = useState(0);
  const loadedRevision = useRef(-1);
  function fill(rules: ScreeningRules) { setCoarse({...rules.coarse}); setPrompt(rules.aiPrompt); setYears(rules.coarse.maxRequiredYears === null ? "" : String(rules.coarse.maxRequiredYears)); setWords(wordsFrom(rules.coarse)); }
  useEffect(() => {
    if (!open || loadedRevision.current === reload) return;
    let cancelled = false;
    setLoading(true); setError("");
    fetch("/api/ai/screening", { cache: "no-store" }).then(async response => {
      const data = await response.json() as { settings?: ScreeningSettings; defaults?: ScreeningRules; error?: string };
      if (!response.ok || !data.settings || !data.defaults) throw new Error(data.error || "无法读取筛选设置");
      if (!cancelled) { loadedRevision.current = reload; setSettings(data.settings); setDefaults(data.defaults); fill(data.settings); setDirty(false); setNotice(""); }
    }).catch(e => { if (!cancelled) setError(e.message || "读取失败，请重试"); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, reload]);
  function changed() { setDirty(true); setNotice(""); setError(""); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!coarse || !settings) return;
    const maxRequiredYears = years.trim() === "" ? null : Number(years);
    if (maxRequiredYears !== null && (!Number.isInteger(maxRequiredYears) || maxRequiredYears < 0 || maxRequiredYears > 30)) { setError("经验阈值请填 0–30 的整数，留空表示不限制"); return; }
    if (!prompt.trim() || prompt.length > 16000) { setError("AI prompt 不能为空，最多 16000 字符"); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      const keywords = Object.fromEntries(wordFields.map(([key]) => [key, words[key].split(/[\n,，;；]+/).map(v => v.trim()).filter(Boolean)]));
      const response = await fetch("/api/ai/screening", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ coarse: { ...coarse, ...keywords, maxRequiredYears }, aiPrompt: prompt, version: settings.version }) });
      const data = await response.json() as { settings?: ScreeningSettings; error?: string }; if (!response.ok || !data.settings) throw new Error(data.error || "保存失败，请重试");
      setSettings(data.settings); fill(data.settings); setDirty(false);
      setNotice("已保存，下次同步或队列审核使用新设置；已有职位不会立即重审，今日 AI 已用次数保持不变。");
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  }
  return <div className="mt-4 rounded-xl border border-[#d2ddca] bg-white/80">
    <button type="button" aria-expanded={open} aria-controls="screening-settings-editor" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-[#305336]">
      <span>粗筛条件与 AI Prompt</span><span aria-hidden="true">{open ? "收起 −" : "编辑 ＋"}</span>
    </button>
    {open && <div id="screening-settings-editor" className="border-t border-[#d2ddca] p-4">
      {loading ? <p role="status" className="text-sm text-[#64725d]">读取设置中…</p> : coarse && settings ? <form onSubmit={save} aria-label="粗筛条件与 AI Prompt 设置">
        <p className="mb-4 text-xs leading-6 text-[#64725d]">粗筛决定哪些岗位进入 AI；AI prompt 再判断是否收录。关闭粗筛条件后，AI 仍会按你写的 prompt 判断。日期窗口、去重和 7 天保留规则继续生效。</p>
        <fieldset disabled={saving} className="min-w-0"><legend className="mb-3 text-sm font-semibold text-[#305336]">第一轮：本地粗筛</legend>
          <div className="grid gap-3 sm:grid-cols-2">{switches.map(([key, label]) => <label key={key} className="flex items-start gap-2 text-sm leading-6 text-[#52694b]"><input type="checkbox" checked={Boolean(coarse[key])} onChange={e => { changed(); setCoarse({...coarse, [key]:e.target.checked}); }} className="mt-1 accent-[#305336]" />{label}</label>)}</div>
          <label htmlFor="screening-experience-years" className="mt-4 block text-sm text-[#305336]">必备工作经验最低年数的上限</label>
          <input id="screening-experience-years" type="number" min="0" max="30" step="1" value={years} onChange={e => { changed(); setYears(e.target.value); }} className="source-input mt-2 w-32" placeholder="不限制" />
          <p className="mt-1 text-xs leading-6 text-[#64725d]">默认 2：明确要求至少 3 年及以上的岗位会被粗筛拒绝；优先经验不算。留空则不在粗筛限制年数。</p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">{wordFields.map(([key, label, help]) => <div key={key} className="min-w-0"><label htmlFor={`screening-${key}`} className="text-sm text-[#305336]">{label}</label><textarea id={`screening-${key}`} value={words[key]} onChange={e => { changed(); setWords({...words, [key]: e.target.value}); }} rows={3} maxLength={4050} className="source-input mt-2 w-full resize-y" /><p className="mt-1 text-xs leading-5 text-[#64725d]">{help}。每行一个或逗号分隔，不区分大小写，按文字匹配。</p></div>)}</div>
          <label htmlFor="screening-ai-prompt" className="mt-5 block text-sm font-semibold text-[#305336]">第二轮：DeepSeek 筛选 Prompt</label>
          <textarea id="screening-ai-prompt" value={prompt} onChange={e => { changed(); setPrompt(e.target.value); }} rows={14} maxLength={16000} spellCheck={false} className="source-input mt-2 w-full resize-y font-mono text-xs leading-6" />
          <p className="mt-1 text-xs leading-6 text-[#64725d]">{prompt.length} / 16000 字符。可调整目标方向、相关度和录取判断。支持的分类、实习/应届/初级、中美地点、JD 证据及签证标注仍由统一输出格式校验；修改 prompt 后不会复用旧 prompt 的筛选缓存。</p>
          <div className="mt-4 flex flex-wrap gap-3"><button type="submit" disabled={saving || !dirty} className="sync-button">{saving ? "保存中…" : "保存筛选设置"}</button><button type="button" className="source-input text-sm" onClick={() => { if (defaults) { fill(defaults); changed(); setNotice("已恢复默认草稿，点击保存后生效。"); } }}>恢复默认</button><button type="button" className="source-input text-sm" onClick={() => setReload(r => r + 1)}>重新加载已保存设置</button></div>
        </fieldset>
        {active && <p className="mt-2 text-xs text-[#64725d]">当前同步继续使用启动时的设置；本次保存从下一次同步生效。</p>}
        {notice && <p role="status" className="mt-3 text-xs leading-6 text-[#305336]">{notice}</p>}
      </form> : <button onClick={() => setReload(r => r + 1)} className="source-input text-sm">重新读取设置</button>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </div>}
  </div>;
}
