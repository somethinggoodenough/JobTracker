import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {loadLocalTypeScript} from '../scripts/load-local-typescript.mjs';
const {dailyModelBudget,reserveModelRequest,DailyModelLimit}=loadLocalTypeScript('lib/ai-budget.ts');
const {parseDailyLimit,saveAiSettings,aiSettings}=loadLocalTypeScript('lib/ai-settings.ts');
const {dayWindow,withCrawlWindow}=loadLocalTypeScript('lib/crawl-window.ts');
const {createPostingSelection,selectPostingRows}=loadLocalTypeScript('lib/crawl-policy.ts');
const {createJobClassifier,AwaitingClassification}=loadLocalTypeScript('lib/job-classifier.ts');
const {localShortlist}=loadLocalTypeScript('lib/local-shortlist.ts');
const {upsertJob}=loadLocalTypeScript('lib/job-storage.ts');
const {reviewCurrentCandidate}=loadLocalTypeScript('lib/job-candidates.ts');
function database(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const name of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+name,'utf8'));
 const db={prepare(sql){let values=[];return{bind(...input){values=input;return this;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return{results:sqlite.prepare(sql).all(...values)};},async run(){const r=sqlite.prepare(sql).run(...values);return{meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const r=[];for(const stmt of statements)r.push(await stmt.run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 return{db,sqlite};
}
const now=new Date(),source={id:1,name:'Example',url:'https://example.invalid',adapter:'jsonld'};
const job={externalId:'one',company:'Example',title:'Backend Engineer Intern',location:'New York, US',description:'Backend services with Python. Internship for currently enrolled students.',canonicalUrl:'https://example.invalid/job',postedAt:null};
const decision={accepted:true,categories:['backend_distributed'],careerLevel:'internship',countries:['US'],techStack:[{name:'Python',evidence:'with Python'}],roleEvidence:'Backend services',levelEvidence:'Internship',locationEvidence:'New York, US',reason:'工程实习'};
const config={apiKey:'test-only-secret',model:'deepseek-flash'};
const result=value=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:20}});
test('Unknown date limit is fifty per source across pages; known dates still use today',()=>{
 const window=dayWindow(new Date('2026-11-17T12:00Z'));
 withCrawlWindow(window,()=>{const selector=createPostingSelection();let n=0;for(let page=0;page<8;page++)for(let row=0;row<10;row++)if(selector.accept(null))n++;assert.equal(n,50);assert(selector.stop(Array(10).fill(null)));assert(selector.accept('2026-11-17'));assert(!selector.accept('2026-11-16'));const selected=selectPostingRows([...Array(80).fill(null),'2026-11-17','2026-11-16'],date=>date);assert.equal(selected.length,51);});
});

test('AI queue reviews only the current New York day or undated jobs, without deleting approved history',async()=>{
 const {db,sqlite}=database();sqlite.prepare('INSERT INTO sources(name,url) VALUES(?,?)').run(source.name,source.url);
 const historical={...job,postedAt:'2026-11-17T12:00:00Z'},classifier=createJobClassifier(db,config);
 await upsertJob(db,source,historical,'2026-11-18T12:00:00Z',Date.parse('2026-11-11T12:00:00Z'),classifier,config.model,decision,'2026-11-17T12:00:00Z',true);
 const window=dayWindow(new Date('2026-11-18T12:00Z'));let calls=0;
 const spy={metrics:{ruleRejected:0},evaluate:async()=>{calls++;return decision;}};
 await withCrawlWindow(window,async()=>{
  for(const postedAt of ['2026-11-17','2026-11-18T04:59:59Z','2026-11-19'])assert.equal(await reviewCurrentCandidate(spy,{...job,postedAt}),null);
  assert.equal(calls,0);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM jobs').get().n,1);
  for(const postedAt of ['2026-11-18','2026-11-18T05:00:00Z',null])assert.equal((await reviewCurrentCandidate(spy,{...job,postedAt})).accepted,true);
 });assert.equal(calls,3);assert.equal(spy.metrics.ruleRejected,3);sqlite.close();
});
test('Atomic daily quota permits exactly one hundred requests under concurrency',async()=>{
 const {db,sqlite}=database();const reservations=await Promise.allSettled(Array.from({length:130},()=>reserveModelRequest(db,now)));
 assert.equal(reservations.filter(r=>r.status==='fulfilled').length,100);assert(reservations.filter(r=>r.status==='rejected').every(r=>r.reason instanceof DailyModelLimit));assert.equal((await dailyModelBudget(db,now)).remaining,0);sqlite.close();
});
test('Quota resets on New York midnight, including daylight saving transitions',async()=>{
 const {db,sqlite}=database();await reserveModelRequest(db,new Date('2026-03-08T04:59:59Z'));const before=await dailyModelBudget(db,new Date('2026-03-08T04:59:59Z'));const after=await dailyModelBudget(db,new Date('2026-03-08T05:00:00Z'));assert.equal(before.day,'2026-03-07');assert.equal(after.day,'2026-03-08');assert.equal(after.used,0);assert.equal(after.resetsAt,'2026-03-09T04:00:00.000Z');sqlite.close();
});
test('Calls already made today consume the budget instead of granting another hundred',async()=>{
 const {db,sqlite}=database();for(let i=0;i<120;i++)sqlite.prepare('INSERT INTO ai_usage(id,model,created_at) VALUES(?,?,?)').run(String(i),'deepseek-flash',now.toISOString());const budget=await dailyModelBudget(db,now);assert.equal(budget.used,120);assert.equal(budget.remaining,0);await assert.rejects(reserveModelRequest(db,now),DailyModelLimit);sqlite.close();
});
test('Corrective retry cannot exceed the remaining daily model allowance',async t=>{
 const {db,sqlite}=database();sqlite.prepare('INSERT INTO ai_daily_budget(day,used) VALUES(?,99)').run(dayWindow(now).date);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return result({...decision,careerLevel:'wrong'});});await assert.rejects(createJobClassifier(db,config).evaluate(job),DailyModelLimit);assert.equal(calls,1);assert.equal((await dailyModelBudget(db)).used,100);sqlite.close();
});

test('Daily quota accepts a chosen integer, zero pause or explicit unlimited mode',()=>{
 for(const dailyLimit of [0,1,250,5000,1_000_000,null])assert.equal(parseDailyLimit({dailyLimit}),dailyLimit);
 for(const dailyLimit of [-1,1.5,'100',true,undefined,NaN,Infinity,1_000_001])assert.throws(()=>parseDailyLimit({dailyLimit}));
 for(const payload of [null,[],{},100,{dailyLimit:200,apiKey:'not-a-setting'}])assert.throws(()=>parseDailyLimit(payload));
});

test('A chosen quota above one hundred is enforced atomically under concurrency',async()=>{
 const {db,sqlite}=database();await saveAiSettings(db,{dailyLimit:125});
 const reservations=await Promise.allSettled(Array.from({length:150},()=>reserveModelRequest(db,now)));
 assert.equal(reservations.filter(r=>r.status==='fulfilled').length,125);assert.equal((await dailyModelBudget(db,now)).used,125);
 assert.equal((await dailyModelBudget(db,now)).remaining,0);sqlite.close();
});

test('Changing a quota preserves usage, takes effect today and survives the next day',async()=>{
 const {db,sqlite}=database();await Promise.all(Array.from({length:5},()=>reserveModelRequest(db,now)));
 await saveAiSettings(db,{dailyLimit:3});let budget=await dailyModelBudget(db,now);assert.equal(budget.used,5);assert.equal(budget.remaining,0);
 await assert.rejects(()=>reserveModelRequest(db,now),DailyModelLimit);
 await saveAiSettings(db,{dailyLimit:12});budget=await dailyModelBudget(db,now);assert.equal(budget.used,5);assert.equal(budget.remaining,7);
 assert.equal((await aiSettings(db)).dailyLimit,12);
 const tomorrow=new Date(now.getTime()+86400000);budget=await dailyModelBudget(db,tomorrow);assert.equal(budget.limit,12);assert.equal(budget.used,0);
 await saveAiSettings(db,{dailyLimit:0});await assert.rejects(()=>reserveModelRequest(db,tomorrow),/已暂停/);sqlite.close();
});

test('Unlimited mode still records attempts and can be changed back to a finite limit',async()=>{
 const {db,sqlite}=database();await saveAiSettings(db,{dailyLimit:null});
 await Promise.all(Array.from({length:130},()=>reserveModelRequest(db,now)));
 let budget=await dailyModelBudget(db,now);assert.equal(budget.limit,null);assert.equal(budget.remaining,null);assert.equal(budget.used,130);
 await saveAiSettings(db,{dailyLimit:131});await reserveModelRequest(db,now);await assert.rejects(()=>reserveModelRequest(db,now),DailyModelLimit);
 budget=await dailyModelBudget(db,now);assert.equal(budget.used,131);sqlite.close();
});

test('A concurrent quota reduction is checked at reservation time, not only at the earlier budget read',async()=>{
 const {db,sqlite}=database(),prepare=db.prepare.bind(db);let changed=false;
 db.prepare=sql=>{if(sql.startsWith('UPDATE ai_daily_budget')&&!changed){changed=true;sqlite.exec('UPDATE ai_settings SET daily_limit=0 WHERE id=1');}return prepare(sql);};
 await assert.rejects(()=>reserveModelRequest(db,now),DailyModelLimit);assert(changed);assert.equal((await dailyModelBudget(db,now)).used,0);sqlite.close();
});

test('Historical usage arriving after initialization is reconciled without granting extra quota',async()=>{
 const {db,sqlite}=database();await dailyModelBudget(db,now);await saveAiSettings(db,{dailyLimit:12});
 for(let i=0;i<10;i++)sqlite.prepare('INSERT INTO ai_usage(id,model,created_at) VALUES(?,?,?)').run(String(i),'test-model',now.toISOString());
 assert.equal((await dailyModelBudget(db,now)).used,10);
 const reservations=await Promise.allSettled(Array.from({length:10},()=>reserveModelRequest(db,now)));assert.equal(reservations.filter(r=>r.status==='fulfilled').length,2);
 assert.equal((await dailyModelBudget(db,now)).used,12);sqlite.close();
});

test('Coarse screening rejects clear non-target roles and required senior experience without an AI call',async t=>{
 const {db,sqlite}=database();await saveAiSettings(db,{dailyLimit:0});let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('Coarse-screened jobs must not call AI');});
 const classifier=createJobClassifier(db,config);
 for(const item of [
  {...job,title:'AI Marketing Intern'},
  {...job,title:'Frontend Engineer Intern'},
  {...job,title:'Software Test Engineer New Grad'},
  {...job,title:'Backend Engineer Intern',description:'Requirements:\nAt least 3 years of professional experience with backend services and Python.'},
  {...job,title:'后端开发工程师',description:'岗位要求：至少三年以上相关工作经验，熟练使用 Python。'},
 ]){const value=await classifier.evaluate(item);assert.equal(value.accepted,false);}
 assert.equal(calls,0);assert.equal(classifier.metrics.ruleRejected,5);assert.equal(classifier.metrics.requests,0);assert.equal((await dailyModelBudget(db)).used,0);sqlite.close();
});

test('Coarse screening preserves internships, mixed full stack roles, low minimums and merely preferred experience',()=>{
 for(const item of [
  {...job,description:job.description+'\nPreferred qualifications:\n3 years of relevant experience is a plus.'},
  {...job,title:'Frontend / Backend Engineer Intern'},
  {...job,title:'Backend Engineer',description:'Requirements:\n2-4 years of professional experience in backend engineering.'},
  {...job,title:'后端实习生',description:'岗位要求：在读本科生，会 Python。\n三年相关经验者优先。'},
  {...job,description:job.description+'\nRequirements:\n3 years of professional experience is not required.'},
  {...job,title:'算法实习生',description:'岗位要求：在读博士，三年以上科研项目经验，熟悉 Python。'},
 ])assert.equal(localShortlist(item).reason,null,item.description);
});
test('Local shortlist avoids generic/sales/seniority-unknown roles and preserves early-career engineering signals',()=>{
 for(const item of [{...job,title:'Account Executive Intern'},{...job,title:'Software Engineer',description:'Build APIs. Mentor junior engineers. Five years experience required.'},{...job,title:'后端开发工程师',description:'工作经验：12年，开发分布式系统'},{...job,title:'后端工程师',description:'12年相关经验'}])assert(localShortlist(item).reason);
 for(const item of [job,{...job,title:'Backend Engineer',description:'Build backend services. 2 years of experience with Python.'},{...job,title:'Full Stack Engineer New Grad'}])assert.equal(localShortlist(item).reason,null);
});
test('Cache-only intake queues a candidate without making any model request',async t=>{
 const {db,sqlite}=database();sqlite.prepare('INSERT INTO sources(name,url) VALUES(?,?)').run(source.name,source.url);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return result(decision);});const classifier=createJobClassifier(db,config);
 await assert.rejects(classifier.evaluate(job,{cacheOnly:true}),AwaitingClassification);
 const first=await upsertJob(db,source,job,now.toISOString(),now.getTime()-7*86400000,classifier,config.model);assert.equal(first.state,'queued');assert.equal(calls,0);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM jobs').get().n,0);
 await upsertJob(db,source,job,new Date(now.getTime()+3600000).toISOString(),now.getTime()-7*86400000,classifier,config.model);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM job_candidates').get().n,1);assert.equal(sqlite.prepare('SELECT first_seen_at FROM job_candidates').get().first_seen_at,now.toISOString());sqlite.close();
});
test('Unknown-date first discovery survives repeat crawls, deletion and an exact seven-day expiry',async()=>{
 const {db,sqlite}=database();sqlite.prepare('INSERT INTO sources(name,url) VALUES(?,?)').run(source.name,source.url);const classifier=createJobClassifier(db,config),start=now.toISOString();
 assert.equal((await upsertJob(db,source,job,start,now.getTime()-7*86400000,classifier,config.model,decision)).state,'added');
 let stored=sqlite.prepare('SELECT * FROM jobs').get();assert.equal(stored.publication_verified,0);assert.equal(stored.posted_at,start);assert.equal(stored.first_seen_at,start);
 const later=new Date(now.getTime()+2*86400000);await upsertJob(db,source,job,later.toISOString(),later.getTime()-7*86400000,classifier,config.model,decision);stored=sqlite.prepare('SELECT * FROM jobs').get();assert.equal(stored.first_seen_at,start);assert.equal(stored.posted_at,start);
 sqlite.exec('DELETE FROM jobs');const expiry=new Date(now.getTime()+7*86400000);const outcome=await upsertJob(db,source,job,expiry.toISOString(),now.getTime(),classifier,config.model,decision);assert.equal(outcome.state,'ignored');assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM jobs').get().n,0);sqlite.close();
});
test('Queued dated job can be admitted tomorrow without pretending it was published tomorrow',async()=>{
 const {db,sqlite}=database();sqlite.prepare('INSERT INTO sources(name,url) VALUES(?,?)').run(source.name,source.url);const tomorrow=new Date(now.getTime()+86400000),classifier=createJobClassifier(db,config);
 const dated={...job,postedAt:now.toISOString()};await upsertJob(db,source,dated,tomorrow.toISOString(),tomorrow.getTime()-7*86400000,classifier,config.model,decision,now.toISOString(),true);const stored=sqlite.prepare('SELECT * FROM jobs').get();assert.equal(stored.publication_verified,1);assert.equal(stored.posted_at,now.toISOString());sqlite.close();
});
