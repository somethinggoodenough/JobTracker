import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalCrawler } from '../scripts/local-crawler.mjs';
import { loadLocalTypeScript } from '../scripts/load-local-typescript.mjs';
import { localD1 } from './local-d1.mjs';

const lib = loadLocalTypeScript('lib/posting-ledger.ts');
const { createPostingSelection } = loadLocalTypeScript('lib/crawl-policy.ts');
const { dayWindow, withCrawlWindow } = loadLocalTypeScript('lib/crawl-window.ts');
const { upsertJob } = loadLocalTypeScript('lib/job-storage.ts');
const { createJobClassifier } = loadLocalTypeScript('lib/job-classifier.ts');
const now = Date.parse('2026-11-19T19:00:00Z'), hour = 3600_000;
const stamp = new Date(now).toISOString(), ago = hours => new Date(now-hours*hour).toISOString();
const prev = {crawled_at:ago(5),observed_count:60,scan_complete:1};
const existing = {freshness:'uncertain', appearedAfter:ago(9), reason:'legacy'};
const classify = input=>lib.classifyFreshness({key:'job',position:1,known:new Set(),prev,now,...input});

test('Freshness precedence covers publication, update, listing, novelty, coverage, discovery history and gaps', () => {
  assert.equal(classify({date:ago(4),dateKind:'published',known:new Set(['job'])}).freshness,'published');
  assert.equal(classify({date:ago(170),dateKind:'updated'}),null);
  assert.equal(classify({date:ago(10),dateKind:'updated'}).freshness,'new');
  assert.equal(classify({date:ago(170),dateKind:'listed',known:new Set(['job'])}).freshness,'baseline');
  assert.deepEqual(classify({date:ago(20),dateKind:'listed',known:new Set(['job'])}),{freshness:'new',appearedAfter:ago(20),reason:null});
  assert.equal(classify({date:ago(52),dateKind:'listed'}).reason,'listing_date');
  assert.deepEqual(classify({known:new Set(['job']),existing}),existing);
  assert.equal(classify({prev:null}).freshness,'baseline');
  assert.equal(classify({firstSeenElsewhere:ago(40)}).reason,'other_source');
  assert.equal(classify({position:60,prev:{...prev,scan_complete:0}}).reason,'scan_range');
  assert.equal(classify({prev:{...prev,crawled_at:ago(170)}}).freshness,'baseline');
  assert.equal(classify({prev:{...prev,crawled_at:ago(40)}}).reason,'gap');
  assert.deepEqual(classify({}),{freshness:'new',appearedAfter:ago(5),reason:null});
});

test('Each scan tracks beyond the baseline cap and excludes old IDs that move into the top 50', () => {
  const baseline=lib.postingContext();
  const input=Array.from({length:60},(_,i)=>String(i+1));
  lib.ledger.run(baseline,()=>{
    const selector=createPostingSelection();
    assert.equal(input.filter(id=>selector.accept(null,id)).length,50);
    lib.completePostingScan();
  });
  assert.equal(baseline.observed.length,60); assert.equal(baseline.scanComplete,true);
  const next=lib.postingContext(baseline.observed.map(row=>row.key),true);
  lib.ledger.run(next,()=>{
    const selector=createPostingSelection();
    assert.equal(input.slice(5).filter(id=>selector.accept(null,id)).length,0);
    assert.equal(selector.accept(null,'new-id'),true);
    assert.equal(selector.accept(null,'new-id'),false);
  });
  const capped=lib.postingContext();
  lib.ledger.run(capped,()=>{
    const selector=createPostingSelection();
    for(let i=0;i<300;i++) selector.accept(null,String(i));
    assert.equal(selector.stop([null]),true);
    assert.equal(capped.scanComplete,false);
  });
  const pages=lib.postingContext();
  lib.ledger.run(pages,()=>{
    const selector=createPostingSelection();
    for(let i=0;i<20;i++) {selector.accept(null,String(i)); assert.equal(selector.stop([null]),i===19);}
    assert.equal(pages.scanComplete,false);
  });
  const basic=createPostingSelection();
  assert.equal(input.filter(()=>basic.accept(null)).length,50);
  assert.equal(basic.stop([null]),true);
});

test('Only successful snapshots set the comparison point and failed sources never extend the ledger', async t => {
  const { db,sqlite }=localD1(t);
  sqlite.exec("INSERT INTO sources(id,name,url) VALUES(1,'f','https://example.com'); INSERT INTO scrape_runs(id,status,started_at) VALUES(1,'running','a'),(2,'running','b'),(3,'running','c');");
  const one=lib.postingContext(); lib.observePosting(one,'old');
  await lib.savePostingSnapshot(db,1,1,ago(3),one,'success');
  const other=lib.postingContext(); lib.observePosting(other,'partial');
  await lib.savePostingSnapshot(db,1,2,ago(2),other,'partial');
  const failed=lib.postingContext(); lib.observePosting(failed,'failed');
  await lib.savePostingSnapshot(db,1,3,ago(1),failed,'failed');
  const ledger=await lib.readPostingLedger(db,1);
  assert.equal(ledger.prev.crawled_at,ago(3));
  assert.deepEqual([...ledger.context.known].sort(),['old','partial']);
  assert.equal(sqlite.prepare('SELECT status FROM source_snapshots WHERE run_id=3').get().status,'failed');
});

test('Backfill classifies New York first days without inventing snapshots and persistence never downgrades freshness', async t => {
  const { db,sqlite }=localD1(t);
  const source={id:1,name:'f',url:'https://example.com',adapter:'jsonld'};
  sqlite.exec("INSERT INTO sources(id,name,url) VALUES(1,'f','https://example.com');");
  const insert=sqlite.prepare(`INSERT INTO jobs(source_id,source_external_key,dedupe_key,canonical_url,company,title,posted_at,
    publication_verified,first_seen_at,last_seen_at,updated_at,freshness_reason)
    VALUES(1,?1,?1,?2,'f','role',?3,?4,?3,?3,?3,'legacy_pending')`);
  insert.run('1: Match  A ','https://example.com/a','2026-11-17T23:00:00Z',0);
  insert.run('1:b','https://example.com/b','2026-11-18T02:00:00Z',0);
  insert.run('1:c','https://example.com/c','2026-11-18T12:00:00Z',0);
  insert.run('1:d','https://example.com/d','2026-11-19T12:00:00Z',1);
  await lib.backfillPostingLedger(db); await lib.backfillPostingLedger(db);
  assert.deepEqual(sqlite.prepare('SELECT freshness FROM jobs ORDER BY id').all().map(row=>row.freshness),['baseline','baseline','uncertain','published']);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM source_postings WHERE posting_key='match a'").get().n,1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM source_snapshots').get().n,0);
  const cfg={apiKey:'',model:'fixture'}, classifier=createJobClassifier(db,cfg);
  const decision={accepted:true,countries:['US'],categories:['backend_distributed'],careerLevel:'junior',techStack:[]};
  const base={externalId:'k',canonicalUrl:'https://example.com/k',company:'f',title:'Junior backend',location:'NY',description:'JD'};
  const persist = job => withCrawlWindow(dayWindow(new Date(now)),()=>upsertJob(db,source,{...base,...job},stamp,now-7*24*hour,classifier,cfg.model,decision));
  await persist({freshness:{freshness:'new',appearedAfter:ago(3),reason:null}});
  const latest = () => sqlite.prepare("SELECT freshness,appeared_after FROM jobs WHERE source_external_key='1:k'").get();
  await persist({freshness:{freshness:'baseline',appearedAfter:null,reason:null}}); assert.equal(latest().freshness,'new');
  await persist({postedAt:stamp}); assert.equal(latest().freshness,'published'); assert.equal(latest().appeared_after,null);
});

test('The local crawler accepts a one MiB UTF-8 request and returns observations', async t => {
  const fixture={id:1,name:'test',url:'https://example.com',adapter:'auto'};
  const server=createLocalCrawler({key:'fixture-only',filename:':memory:',allow:()=>true,execute:async()=>{
    const selection=createPostingSelection();
    selection.accept(null,'既知'); selection.accept(null,'new');
    lib.completePostingScan();
    return [];
  }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const payload={source:fixture,window:dayWindow(new Date(now)),postingLedger:{known:['既知'],hasSnapshot:true},crawlId:'1:1',
    deadlineMs:Date.now()+15_000, padding:''};
  payload.padding='x'.repeat(1024*1024-Buffer.byteLength(JSON.stringify(payload)));
  const body=JSON.stringify(payload);
  assert.equal(Buffer.byteLength(body),1024*1024);
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/crawl',{method:'POST',headers:{authorization:'Bearer fixture-only'},body});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.deepEqual(result.postingScan.observed,[{key:'既知',position:0},{key:'new',position:1}]);
  assert.equal(result.postingScan.scanComplete,true);
});
