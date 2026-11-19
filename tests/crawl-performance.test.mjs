import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDetailStore } from '../scripts/local-crawler.mjs';
import { loadLocalTypeScript } from '../scripts/load-local-typescript.mjs';
const { crawlSource } = loadLocalTypeScript('lib/crawler.ts');
const { detailCache } = loadLocalTypeScript('lib/detail-cache.ts');
const { requestLimiter, crawlMetrics, crawlPerformance } = loadLocalTypeScript('lib/crawl-performance.ts');
const { dayWindow, withCrawlWindow } = loadLocalTypeScript('lib/crawl-window.ts');
const { numberedPages } = loadLocalTypeScript('lib/list-pages.ts');
const { fetchSource } = loadLocalTypeScript('lib/crawler-http.ts');
const { workdayRateLimit, WorkdayRateLimitError, WORKDAY_REQUEST_GAP_MS } = loadLocalTypeScript('lib/workday-rate-limit.ts');

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
    limit(new URL(`https://tenant${i}.greenhouse.io/jobs`), async () => {
      active++;
      peak = Math.max(peak, active);
      await blocked;
      active--;
    }));
  const controller = new AbortController();
  const future = limit(new URL('https://tenant11.greenhouse.io/jobs'), () => assert.fail('Cancelled waiter should not start'), controller.signal);
  controller.abort();
  try { await assert.rejects(future, /abort/i); assert.equal(peak, 5); }
  finally { release(); await Promise.all(requests); }
});

test('Workday requests are serial across tenants, spaced apart, and leave other providers eligible', async () => {
  const limit = requestLimiter(3);
  const order = [];
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let start;
  const first = limit(new URL('https://tenant1.myworkdayjobs.com/jobs'), async () => {
    start = Date.now();
    order.push('first');
    await blocked;
  });
  const second = limit(new URL('https://tenant2.myworkdayjobs.com/jobs'), () => {
    assert(Date.now() - start >= WORKDAY_REQUEST_GAP_MS - 15);
    order.push('second');
  });
  try {
    await limit(new URL('https://example.com/jobs'), () => order.push('other'));
    assert.deepEqual(order, ['first', 'other']);
  } finally { release(); await Promise.all([first, second]); }
  assert.deepEqual(order, ['first', 'other', 'second']);
});

test('A Workday 429 captures Retry-After and stops queued details without short retries', async t => {
  const url = new URL('https://nvidia.wd5.myworkdayjobs.com/jobs?tracking=test');
  const now = Date.parse('2026-11-19T04:00:00.000Z');
  const httpDate = 'Thu, 19 Nov 2026 04:02:00 GMT';
  assert.deepEqual(workdayRateLimit(url, '120', now), { address: url.host + url.pathname, retryAfter: '120', retryAt: now + 120_000 });
  assert.equal(workdayRateLimit(url, httpDate, now).retryAt, now + 120_000);
  assert.equal(workdayRateLimit(url, 'invalid', now).retryAt, null);
  assert.equal(workdayRateLimit(url, null, now).retryAt, null);
  const metrics = crawlMetrics();
  let workdayCalls = 0;
  t.mock.method(globalThis, 'fetch', async input => {
    if (new URL(input).hostname === url.hostname) {
      workdayCalls++;
      return new Response(null, { status: 429, headers: { 'Retry-After': '120' } });
    }
    return Response.json({ ok: true });
  });
  const { withSyncSignal } = loadLocalTypeScript('lib/sync-control.ts');
  const signal = new AbortController().signal;
  const result = await withSyncSignal(signal, () => crawlPerformance.run({ metrics, limit: requestLimiter(3) }, () =>
    Promise.allSettled([fetchSource(url.href), fetchSource(url.origin + '/detail'), fetchSource('https://example.com/jobs')])));
  assert(result[0].reason instanceof WorkdayRateLimitError);
  assert(result[1].reason instanceof WorkdayRateLimitError);
  assert.equal(result[2].status, 'fulfilled');
  assert.equal(workdayCalls, 1);
  assert.equal(metrics.throttled, 1);
  assert.equal(metrics.workdayCooldown.retryAfter, '120');
});

test('Unsorted numbered feeds preserve page order when later pages finish first', async () => {
  const pages = [];
  for await (const rows of numberedPages(async page => {
    if (page === 2) await new Promise(resolve => setTimeout(resolve, 15));
    return { rows: [page], total: 4 };
  }, 1, 8)) pages.push(...rows);
  assert.deepEqual(pages, [1, 2, 3, 4]);
});
