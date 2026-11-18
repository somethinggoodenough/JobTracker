import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import registry from "../data/source-registry.json" with { type: "json" };

const baseUrl = process.argv[2] ?? "http://127.0.0.1:4173";
const providerNames = new Set(registry.filter((item) => item.kind === "provider").map((item) => item.name));

async function json(url, init) {
  const response = await fetch(url, init);
  const body = await response.json();
  return { response, body };
}

const imported = await json(`${baseUrl}/api/sources/import-registry`, { method: "POST" });
if (!imported.response.ok) throw new Error(JSON.stringify(imported.body));
console.log(`Imported registry: ${imported.body.total}`);

const sourceResponse = await json(`${baseUrl}/api/sources`);
const candidates = sourceResponse.body.sources.filter((source) => !providerNames.has(source.name));
const results = [];
let cursor = 0;

async function worker() {
  while (cursor < candidates.length) {
    const source = candidates[cursor++];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15 * 60_000);
    try {
      const { response, body } = await json(`${baseUrl}/api/sources/${source.id}`, { method: "POST", signal: controller.signal });
      results.push({ name: source.name, url: source.url, ok: response.ok && body.ok, jobs: body.jobs ?? 0,
        adapter: body.adapter ?? source.adapter, error: body.error ?? null });
    } catch (error) {
      results.push({ name: source.name, url: source.url, ok: false, jobs: 0, adapter: source.adapter,
        error: error instanceof Error ? error.message : String(error) });
    } finally {
      clearTimeout(timer);
      if (results.length % 10 === 0 || results.length === candidates.length) {
        console.log(`Verified ${results.length}/${candidates.length}`);
      }
    }
  }
}

await Promise.all(Array.from({ length: 8 }, () => worker()));
results.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
const providers = registry.filter((item) => item.kind === "provider").map((item) => ({
  name: item.name, url: item.url, ok: false, jobs: 0, adapter: "provider", error: item.note,
}));
const report = [...providers, ...results];
const passed = report.filter((item) => item.ok);
const failed = report.filter((item) => !item.ok);
mkdirSync(path.resolve("outputs"), { recursive: true });
writeFileSync(path.resolve("outputs/source-verification.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), total: report.length, passed: passed.length, failed: failed.length, sources: report,
}, null, 2));
const rows = report.map((item) => `| ${item.ok ? "✅" : "❌"} | ${item.name.replaceAll("|", "\\|")} | ${item.adapter} | ${item.jobs} | ${(item.error ?? "可抓取").replaceAll("|", "\\|").replaceAll("\n", " ")} |`);
writeFileSync(path.resolve("outputs/source-verification.md"), [
  "# 来源验证报告", "", `生成时间：${new Date().toISOString()}`, "",
  `- 总数：${report.length}`, `- 可抓取：${passed.length}`, `- 不可抓取/非单一 feed：${failed.length}`, "",
  "| 状态 | 来源 | 适配器 | 探测职位数 | 说明 |", "|---|---|---:|---:|---|", ...rows, "",
].join("\n"));
console.log(JSON.stringify({ total: report.length, passed: passed.length, failed: failed.length }));
