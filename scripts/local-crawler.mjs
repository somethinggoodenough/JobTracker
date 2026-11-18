import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { loadLocalTypeScript } from './load-local-typescript.mjs';

const { executeCrawl, isBuiltInBoard } = loadLocalTypeScript('lib/crawl-execution.ts');
const { requestLimiter, crawlMetrics } = loadLocalTypeScript('lib/crawl-performance.ts');
const { withSyncSignal } = loadLocalTypeScript('lib/sync-control.ts');
const { withCrawlWindow } = loadLocalTypeScript('lib/crawl-window.ts');
const { withScreeningRules } = loadLocalTypeScript('lib/screening-context.ts');

export function openDetailStore(filename) {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  const schema = readFileSync(new URL('../drizzle/0011_puzzling_living_lightning.sql', import.meta.url), 'utf8').split('--> statement-breakpoint')[0];
  sqlite.exec(schema.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS'));
  sqlite.exec('CREATE INDEX IF NOT EXISTS crawl_details_expiry_idx ON crawl_details(expires_at)');
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return { bind(...args) {
        return { async all() { return { results: statement.all(...args) }; }, run() { return statement.run(...args); } };
      } };
    },
    async batch(writes) {
      sqlite.exec('BEGIN');
      try { for (const write of writes) write.run(); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { db, prune: () => sqlite.prepare('DELETE FROM crawl_details WHERE expires_at<=?').run(Date.now()), close: () => sqlite.close() };
}

if (process.send) process.once('message', ({ port, key, filename }) => {
  const store = openDetailStore(filename);
  store.prune();
  const timer = setInterval(store.prune, 3_600_000);
  timer.unref();
  const authorization = Buffer.from(`Bearer ${key}`);
  let limit, requestCap, active = 0;
  const server = createServer(async (request, response) => {
    const provided = Buffer.from(request.headers.authorization || '');
    if (request.method !== 'POST' || request.url !== '/crawl'
        || provided.length !== authorization.length || !timingSafeEqual(provided, authorization)) {
      response.writeHead(404).end();
      return;
    }
    if (active >= 12) { response.writeHead(503).end(); return; }
    active++;
    const controller = new AbortController();
    response.on('close', () => { if (!response.writableEnded) controller.abort(); });
    const metrics = crawlMetrics();
    const send = body => {
      if (!response.destroyed) response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...body, metrics }));
    };
    try {
      let input = '';
      for await (const chunk of request) {
        input += chunk;
        if (input.length > 25000) throw new Error('Local crawler request too large');
      }
      const { source, window, coarse, concurrency } = JSON.parse(input);
      if (!isBuiltInBoard(source)) throw new Error('Source is outside the local crawler registry');
      if (!limit || active === 1 && requestCap !== concurrency) {
        requestCap = Math.min(24, Math.max(1, Number(concurrency) || 12));
        limit = requestLimiter(requestCap);
      }
      const jobs = await withCrawlWindow(window, () => withSyncSignal(controller.signal, () =>
        withScreeningRules({ coarse, aiPrompt: '' }, () => executeCrawl(store.db, source, { metrics, limit }))));
      send({ jobs, warnings: jobs.warnings });
    } catch (error) { send({ jobs: [], error: error instanceof Error ? error.message : String(error) }); }
    finally { active--; }
  });
  server.listen(port, '127.0.0.1', () => process.send({ port: server.address().port }));
  process.on('disconnect', () => { server.closeAllConnections(); server.close(() => { store.close(); process.exit(0); }); });
});
