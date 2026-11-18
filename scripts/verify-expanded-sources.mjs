import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import targets from '../data/expanded-adapter-targets.json' with { type: 'json' };
import { loadLocalTypeScript } from './load-local-typescript.mjs';
const nodeMode = process.argv.includes('--node');
const filter = process.argv.find(arg => arg.startsWith('--only='))?.slice(7).split(',');
const selected = targets.filter(t => !filter || filter.includes(t.adapter) || filter.includes(t.name));
const base = 'http://127.0.0.1:4173';
const { crawlSource } = nodeMode ? loadLocalTypeScript('lib/crawler.ts') : {};
if (!nodeMode) {
  const r = await fetch(`${base}/api/sources/import-registry`, { method: 'POST' });
  if (!r.ok) throw new Error(await r.text());
}
const sources = nodeMode ? [] : (await (await fetch(`${base}/api/sources`)).json()).sources;
const results = [];
let cursor = 0;
mkdirSync('outputs', { recursive: true });
const reportPath = `outputs/expanded-${nodeMode ? 'node' : 'worker'}-verification.json`;
const previous = filter && existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')).sources : [];
async function worker() {
  while (cursor < selected.length) {
    const target = selected[cursor++], started = Date.now();
    let result;
    try {
      if (nodeMode) {
        const jobs = await crawlSource({ id: -1, ...target });
        result = { ok: true, jobs: jobs.length, warning: jobs.warnings?.join('\n') || null };
      } else {
        const source = sources.find(s => s.name === target.name);
        if (!source) throw new Error('Registry source missing');
        const r = await fetch(`${base}/api/sources/${source.id}`, { method: 'POST', signal: AbortSignal.timeout(12 * 60_000) });
        const body = await r.json();
        result = { ok: r.ok && body.ok, jobs: body.jobs ?? 0, error: body.error || null, warning: body.warning || null };
      }
    } catch (e) { result = { ok: false, jobs: 0, error: e.message }; }
    results.push({ name: target.name, adapter: target.adapter, url: target.url, ...result, checkedAt: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000) });
    const names = new Set(results.map(r => r.name));
    writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), sources: [...previous.filter(r => !names.has(r.name)), ...results] }, null, 2));
    console.log(`${results.length}/${selected.length} ${target.name}: ${result.ok ? `OK ${result.jobs}` : result.error} (${Math.round((Date.now() - started) / 1000)}s)`);
  }
}
await Promise.all(Array.from({ length: 3 }, worker));
console.log(JSON.stringify({ total: results.length, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length }));
