import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDetailStore } from '../scripts/local-crawler.mjs';
import { loadLocalTypeScript } from '../scripts/load-local-typescript.mjs';
const { crawlSource } = loadLocalTypeScript('lib/crawler.ts');
const { detailCache } = loadLocalTypeScript('lib/detail-cache.ts');
const { requestLimiter, crawlMetrics, crawlPerformance } = loadLocalTypeScript('lib/crawl-performance.ts');
const { dayWindow, withCrawlWindow } = loadLocalTypeScript('lib/crawl-window.ts');
const { numberedPages } = loadLocalTypeScript('lib/list-pages.ts');

test('Warm crawl skips unchanged details, refreshes revised details and keeps the publication window', async t => {
  const store = openDetailStore(':memory:');
  t.after(() => store.close());
  const source = { id: 1, name: 'Fixture', adapter: 'greenhouse', url: 'https://job-boards.greenhouse.io/fixture' };
  let revision = 'v1';
  t.mock.method(globalThis, 'fetch', async url => {
    const listing = new URL(url).searchParams.has('content');
    const rows = [
      { id: 1, title: 'Software Engineer Intern', absolute_url: 'https://fixture.test/1', updated_at: revision, first_published: '2026-11-18' },
      { id: 2, title: 'Older Engineer', absolute_url: 'https://fixture.test/2', updated_at: revision, first_published: '2026-11-17' },
    ];
    return Response.json(listing ? { jobs: rows } : { ...rows[0], content: `Build APIs in Python. Revision ${revision}` });
  });
  async function run(date) {
    const metrics = crawlMetrics();
    const jobs = await withCrawlWindow(dayWindow(new Date(date)), () => crawlPerformance.run({ metrics, limit: requestLimiter(4) }, () =>
      detailCache.run({ db: store.db, namespace: 'fixture' }, () => crawlSource(source))));
    return { jobs, metrics };
  }
  const cold = await run('2026-11-18T17:00:00Z');
  const warm = await run('2026-11-18T17:00:00Z');
  assert.deepEqual(warm.jobs, cold.jobs);
  assert.equal(cold.metrics.detailRequests, 1);
  assert.equal(warm.metrics.listRequests, 1);
  assert.equal(warm.metrics.detailRequests, 0);
  assert.equal(warm.metrics.cacheHits, 1);
  revision = 'v2';
  const changed = await run('2026-11-18T17:00:00Z');
  assert.equal(changed.metrics.detailRequests, 1);
  assert.match(changed.jobs[0].description, /v2/);
  assert.equal((await run('2026-11-19T17:00:00Z')).jobs.length, 0);
});

test('Request scheduling caps shared providers and cancels queued requests', async () => {
  const limit = requestLimiter(12);
  let active = 0, peak = 0;
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const requests = Array.from({ length: 10 }, (_, i) =>
    limit(new URL(`https://tenant${i}.myworkdayjobs.com/jobs`), async () => {
      active++;
      peak = Math.max(peak, active);
      await blocked;
      active--;
    }));
  const controller = new AbortController();
  const future = limit(new URL('https://tenant11.myworkdayjobs.com/jobs'), () => assert.fail('Cancelled waiter should not start'), controller.signal);
  controller.abort();
  try { await assert.rejects(future, /abort/i); assert.equal(peak, 5); }
  finally { release(); await Promise.all(requests); }
});

test('Unsorted numbered feeds preserve page order when later pages finish first', async () => {
  const pages = [];
  for await (const rows of numberedPages(async page => {
    if (page === 2) await new Promise(resolve => setTimeout(resolve, 15));
    return { rows: [page], total: 4 };
  }, 1, 8)) pages.push(...rows);
  assert.deepEqual(pages, [1, 2, 3, 4]);
});
