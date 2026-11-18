import { fetchSource } from "./crawler-http";

// Anonymous cookies belong to one crawl only. Never reuse a user's browser session.
export function careerSession() {
  const jars = new Map<string, Map<string, string>>();
  return {
    cookie(url: string, name: string) { return jars.get(new URL(url).host)?.get(name); },
    async fetch(url: string, init: RequestInit = {}) {
      for (let hop = 0; hop < 12; hop++) {
      const host = new URL(url).host, jar = jars.get(host) ?? new Map<string, string>();
      const headers = new Headers(init.headers);
      if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
      const response = await fetchSource(url, { ...init, redirect: "manual", headers: Object.fromEntries(headers) });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";", 1)[0], eq = pair.indexOf("=");
        if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
      jars.set(host, jar);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const target = new URL(response.headers.get("location") || "", url);
        if (target.protocol !== "https:") throw new Error("招聘网站重定向到非 HTTPS 页面");
        await response.body?.cancel();
        if (response.status === 303 || [301, 302].includes(response.status) && init.method === "POST") init = { headers: init.headers };
        url = target.href; continue;
      }
      return response;
      }
      throw new Error("招聘网站重定向次数超过上限");
    },
  };
}

// Parse a JSON assignment in SSR HTML without evaluating remote JavaScript.
export function assignedJson(html: string, marker: string): any {
  const at = html.indexOf(marker);
  if (at < 0) throw new Error(`公开页面数据缺失：${marker}`);
  let start = at + marker.length;
  while (/[\s=]/.test(html[start] ?? "") && start < html.length) start++;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (quoted) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") { if (--depth === 0) {
      // Some SSR serializers emit undefined as a value. Preserve strings verbatim.
      return JSON.parse(html.slice(start, i + 1).replace(/"(?:\\.|[^"\\])*"|\bundefined\b/g, token => token === "undefined" ? "null" : token));
    } }
  }
  throw new Error(`公开页面 JSON 不完整：${marker}`);
}

export function publicDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const time = typeof value === "number" ? value * (value < 1e12 ? 1000 : 1) : Date.parse(String(value));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function requireRows(value: unknown, provider: string): any[] {
  if (!Array.isArray(value)) throw new Error(`${provider} 返回结构改变或接口报错，缺少职位列表`);
  return value;
}

export function jobPostingJson(html: string): any {
  const visit = (value: any): any => {
    if (!value || typeof value !== "object") return null;
    if ([value["@type"]].flat().includes("JobPosting")) return value;
    for (const child of Object.values(value)) { if (child && typeof child === "object") { const found = visit(child); if (found) return found; } }
    return null;
  };
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const node = visit(JSON.parse(match[1])); if (node) return node; } catch { /* another JSON-LD block */ }
  }
  throw new Error("职位页面缺少公开 JobPosting 数据，无法确认完整 JD");
}
