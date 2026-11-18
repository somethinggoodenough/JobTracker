import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {loadLocalTypeScript} from '../scripts/load-local-typescript.mjs';
const {ruleRejection,parseDecision,classificationKey,createJobClassifier}=loadLocalTypeScript('lib/job-classifier.ts');
const {reviewStoredJobs}=loadLocalTypeScript('lib/job-review.ts');
const {withSyncSignal}=loadLocalTypeScript('lib/sync-control.ts');
const {jobQuery}=loadLocalTypeScript('lib/job-query.ts');
const {estimateAiCost}=loadLocalTypeScript('lib/ai-cost.ts');
const {AI_POLICY}=loadLocalTypeScript('lib/classification-types.ts');
const job={externalId:'1',company:'Example',title:'Backend Engineer - New Grad',location:'New York, United States',canonicalUrl:'https://example.invalid/1',description:'New Grad engineering role. Build backend services using Python and PostgreSQL. Location: United States.',postedAt:new Date().toISOString()};
const decision={accepted:true,categories:['backend_distributed'],careerLevel:'new_grad',countries:['US'],techStack:[{name:'Python',evidence:'using Python and PostgreSQL'}],roleEvidence:'backend services',levelEvidence:'New Grad',locationEvidence:'United States',reason:'美国后端应届岗位'};
function database(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const name of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+name,'utf8'));
 const db={prepare(sql){return{bind(...values){return{async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return{results:sqlite.prepare(sql).all(...values)};},async run(){const result=sqlite.prepare(sql).run(...values);return{meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}};}};}};
 return{db,sqlite};
}
const config={apiKey:'test-only-secret',model:'deepseek-flash'};
const response=value=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:3000,completion_tokens:300,prompt_cache_hit_tokens:1000}});
test('Rules reject explicit senior, foreign-only, and missing JD, while preserving multi-country candidates',()=>{
 for(const title of ['Senior Backend Engineer','Sr. Full Stack','Staff Machine Learning Engineer','后端高级研发','工程经理'])assert(ruleRejection({...job,title}));
 assert(ruleRejection({...job,location:'Toronto, Canada'}));assert(ruleRejection({...job,description:''}));
 assert.equal(ruleRejection({...job,location:'United States; Canada'}),null);assert.equal(ruleRejection(job),null);
});
test('Accept only supported categories, early-career levels, US/CN and verbatim JD technology evidence',()=>{
 assert.equal(parseDecision(decision,job).accepted,true);
 for(const bad of [{...decision,countries:['CA']},{...decision,careerLevel:'senior'},{...decision,categories:['marketing']},
  {...decision,levelEvidence:'Junior engineer'}, {...decision,techStack:[{name:'Kubernetes',evidence:'Kubernetes clusters'}]}, {...decision,accepted:'true'}])assert.throws(()=>parseDecision(bad,job));
 assert.equal(parseDecision({accepted:false,reason:'级别不明确'},job).accepted,false);
});
test('Cache identity changes with model, JD, title and location',async()=>{
 const key=await classificationKey(job,config.model);assert.equal(await classificationKey({...job,canonicalUrl:'another URL'},config.model),key);
 for(const changed of [{...job,description:job.description+' Extra requirement.'},{...job,location:'Beijing, China'},{...job,title:'Junior Backend'}])assert.notEqual(await classificationKey(changed,config.model),key);
 assert.notEqual(await classificationKey(job,'deepseek-v4-pro'),key);
});
test('Concurrent duplicates and later hourly runs reuse persistent decisions and do not pay again',async t=>{
 const {db,sqlite}=database();let calls=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(init.headers.Authorization,'Bearer test-only-secret');const body=JSON.parse(init.body);assert.equal(body.thinking.type,'disabled');assert.equal(body.response_format.type,'json_object');return response(decision);});
 const classifier=createJobClassifier(db,config);await Promise.all(Array.from({length:8},()=>classifier.evaluate(job)));
 assert.equal(calls,1);assert.equal((await createJobClassifier(db,config).evaluate(job)).accepted,true);assert.equal(calls,1);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM ai_usage').get().n,1);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM jobs').get().n,0);
 sqlite.close();
});
test('Only four model requests run concurrently',async t=>{
 const {db,sqlite}=database();let active=0,max=0;
 t.mock.method(globalThis,'fetch',async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;return response(decision);});
 const classifier=createJobClassifier(db,config);await Promise.all(Array.from({length:12},(_,i)=>classifier.evaluate({...job,company:'Example '+i})));
 assert.equal(max,4);sqlite.close();
});
test('Missing key, API authentication errors and malformed results fail closed and never create a rejection cache',async t=>{
 const {db,sqlite}=database();let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('must not expose body or secret',{status:401});});
 const classifier=createJobClassifier(db,config);await assert.rejects(classifier.evaluate(job),/HTTP 401/);
 await assert.rejects(classifier.evaluate({...job,company:'Another'}),/HTTP 401/);assert.equal(calls,1);
 await assert.rejects(createJobClassifier(db,{...config,apiKey:''}).evaluate(job),/Key/);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM job_evaluations').get().n,0);sqlite.close();
});
test('Invalid AI evidence is not cached as a business rejection; its billed tokens are still counted',async t=>{
 const {db,sqlite}=database();t.mock.method(globalThis,'fetch',async()=>response({...decision,locationEvidence:'Not in the original text'}));
 await assert.rejects(createJobClassifier(db,config).evaluate(job),/原文依据/);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM job_evaluations').get().n,0);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM ai_usage').get().n,2);sqlite.close();
});
test('A single corrective retry can recover a malformed output and caches only the corrected decision',async t=>{
 const {db,sqlite}=database();let calls=0;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{calls++;const body=JSON.parse(init.body);if(calls===1)return response({...decision,careerLevel:'early-career'});assert.equal(body.max_tokens,2200);assert(body.messages.at(-1).content.includes('failed validation'));return response(decision);});
 assert.equal((await createJobClassifier(db,config).evaluate(job)).accepted,true);assert.equal(calls,2);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM job_evaluations').get().n,1);sqlite.close();
});
test('Cancellation aborts an active DeepSeek request without caching or admitting a job',async t=>{
 const {db,sqlite}=database(),controller=new AbortController();
 t.mock.method(globalThis,'fetch',(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));
 const result=withSyncSignal(controller.signal,()=>createJobClassifier(db,config).evaluate(job));
 setTimeout(()=>controller.abort(new Error('Test cancelled')),15);await assert.rejects(result,/Test cancelled/);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM job_evaluations').get().n,0);sqlite.close();
});
test('Historical review deletes rejections, keeps approved jobs and leaves failed reviews hidden for retry',async()=>{
 const {db,sqlite}=database(),now=new Date().toISOString();
 sqlite.prepare("INSERT INTO sources(name,url,adapter) VALUES('fixture','https://example.invalid','jsonld')").run();
 const insert=sqlite.prepare('INSERT INTO jobs(source_id,source_external_key,dedupe_key,canonical_url,company,title,location,description,posted_at,first_seen_at,last_seen_at,updated_at) VALUES(1,?,?,?,?,?,?,?,?,?,?,?)');
 for(const name of ['approve','reject','retry'])insert.run(name,name,'https://example.invalid/'+name,'Example',name,'US','JD',now,now,now,now);
 let seen=0;const classifier={evaluate:async value=>{if(value.title==='retry')throw new Error('Network unavailable');return value.title==='approve'?decision:{accepted:false,reason:'Non-target'};}};
 const result=await reviewStoredJobs(db,classifier,config.model,async()=>{seen++;});assert.equal(seen,3);assert.equal(result.accepted,1);assert.equal(result.rejected,1);assert.equal(result.errors,1);
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM jobs WHERE title='reject'").get().n,0);
 const q=jobQuery(new URL('http://localhost/api/jobs'));assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM jobs j WHERE '+q.where).get(...q.bindings).n,1);
 assert.equal(sqlite.prepare("SELECT ai_policy FROM jobs WHERE title='retry'").get().ai_policy,null);sqlite.close();
});
test('Category and level pagination filters apply in SQL, including invalid and injection-like values',()=>{
 const {sqlite}=database();
 for(const suffix of ['category=backend_distributed&level=new_grad','category=bad&level=bad',"category='+OR+1%3D1--"]){const q=jobQuery(new URL('http://localhost?'+suffix));assert.doesNotThrow(()=>sqlite.prepare('SELECT COUNT(*) FROM jobs j WHERE '+q.where).get(...q.bindings));assert(q.where.includes(AI_POLICY));}sqlite.close();
});
test('Monthly cost estimate honors input cache discount and current peak/off-peak prices',()=>{
 assert.deepEqual(estimateAiCost([{model:'deepseek-flash',prompt_tokens:3_000_000,completion_tokens:300_000,cached_tokens:0}]),{low:0.63,high:1.26});
 assert(estimateAiCost([{model:'deepseek-flash',prompt_tokens:3_000_000,completion_tokens:300_000,cached_tokens:2_000_000}]).high<1.26);
 assert.equal(estimateAiCost([{model:'unknown'}]),null);
});
