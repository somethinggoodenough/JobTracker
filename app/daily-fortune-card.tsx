"use client";

import { useEffect, useState } from "react";
import { CalendarCheck2, Sparkles } from "lucide-react";
import { drawDailyFortune, fortuneActions, fortuneDay, readFortune, type DailyFortune } from "@/lib/daily-fortune";
import { useLanguage } from "./language-provider";

const storageKey = "job-radar-daily-fortune";

function storedFortune() {
  try { return readFortune(window.localStorage.getItem(storageKey)); }
  catch { return null; }
}

export default function DailyFortuneCard() {
  const { locale, t } = useLanguage();
  const [day, setDay] = useState("");
  const [draw, setDraw] = useState<DailyFortune | null>(null);
  const today = draw?.day === day ? draw : null;

  useEffect(() => {
    const syncDay = () => setDay(fortuneDay());
    function syncDraw(event: StorageEvent) {
      if (event.key === storageKey || event.key === null) setDraw(readFortune(event.newValue));
    }
    syncDay();
    setDraw(storedFortune());
    const interval = window.setInterval(syncDay, 30_000);
    window.addEventListener("storage", syncDraw);
    window.addEventListener("focus", syncDay);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", syncDraw);
      window.removeEventListener("focus", syncDay);
    };
  }, []);

  async function drawToday() {
    function save() {
      const date = fortuneDay();
      const next = drawDailyFortune(date, storedFortune() ?? draw);
      setDay(date);
      setDraw(next);
      try { window.localStorage.setItem(storageKey, JSON.stringify(next)); }
      catch { /* Keep the draw available in memory. */ }
    }
    if (navigator.locks) {
      try { await navigator.locks.request(storageKey, save); return; }
      catch { /* Drawing still works when browser locks are unavailable. */ }
    }
    save();
  }

  const dateLabel = day ? new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(day + "T00:00:00Z")) : "";
  function advice(ids: DailyFortune["favored"], positive: boolean) {
    const label = positive ? t("宜") : t("忌");
    const noAdvice = positive ? t("量力而行") : t("百无禁忌");
    return <div className="min-w-0 space-y-2">
      <h3 className="text-xs font-semibold text-radar-strong">{label}</h3>
      {ids.length ? <ul className="space-y-2">{ids.map(id => {
        const action = fortuneActions.find(item => item.id === id)!;
        return <li key={id}>
          <strong className="text-xs font-medium text-radar-ink">{t(action.label)}</strong>
          <p className="mt-0.5 text-xs leading-5 text-radar-muted">{t(positive ? action.good : action.bad)}</p>
        </li>;
      })}</ul> : <p className="text-xs leading-5 text-radar-muted">{noAdvice}</p>}
    </div>;
  }

  return <section aria-labelledby="daily-fortune-title" className="overflow-hidden rounded-2xl border border-radar-line bg-white shadow-sm">
    <div className="relative isolate overflow-hidden border-b border-radar-line bg-radar-soft px-4 py-3.5 sm:px-5">
      <Sparkles size={72} strokeWidth={1} aria-hidden="true" className="pointer-events-none absolute -right-2 -top-5 -z-10 text-radar-hover" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarCheck2 size={18} aria-hidden="true" className="text-radar-blue" />
          <h2 id="daily-fortune-title" className="text-base font-semibold text-radar-ink">{t("每日求职签")}</h2>
        </div>
        {day && <time dateTime={day} className="text-xs tabular-nums text-radar-muted">{dateLabel}</time>}
      </div>
    </div>
    <div className="px-4 py-4 sm:px-5" aria-live="polite">
      {today ? <>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-radar-border pb-3">
          <strong className="text-2xl font-semibold tracking-tight text-radar-strong" data-fortune-grade>{t(today.grade)}</strong>
          <span className="text-xs text-radar-muted">{t("已连续打卡 {0} 天", today.streak)}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 divide-x divide-radar-line [&>div:first-child]:pr-3 [&>div:last-child]:pl-3">
          {advice(today.favored, true)}{advice(today.avoided, false)}
        </div>
      </> : <>
        <p className="text-sm leading-6 text-radar-muted">{t("每天抽一签，看看今天求职的宜与忌。")}</p>
        <button type="button" className="sync-button mt-3 w-full justify-center" disabled={!day} onClick={() => void drawToday()}>
          <Sparkles size={15} aria-hidden="true" />{t("抽今日签")}
        </button>
      </>}
    </div>
  </section>;
}
