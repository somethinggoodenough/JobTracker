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
const {readAnalysis,jobCategories}=loadLocalTypeScript('lib/classification-types.ts');
const {localShortlist}=loadLocalTypeScript('lib/local-shortlist.ts');
const {confirmedUsSponsorship}=loadLocalTypeScript('lib/sponsorship.ts');
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

test('Quant, data science, solutions, forward deployment and adjacent technical roles reach AI instead of being pre-rejected',()=>{
 for(const title of ['Quant Developer Intern','Quantitative Researcher New Grad','Data Scientist Intern','Marketing Data Scientist Intern','Data Analyst Junior','Business Intelligence Analyst Intern','Applied Scientist New Grad','Solutions Architect New Grad','Solution Architect Intern','Solutions Engineer Junior','Sales Engineer Intern','Forward Deployed Engineer New Grad','Forward Deployment Engineer Intern','Implementation Engineer Junior','Frontend Engineer Intern','Software Test Engineer New Grad','量化开发实习生','数据科学家（校招）','解决方案架构师（应届）']){
  const input={...job,title,description:'Requirements: 0-2 years of experience. Technical customer delivery, Python and statistical analysis.'};
  assert.equal(ruleRejection(input),null,title);assert.equal(localShortlist(input).reason,null,title);
 }
 for(const category of ['quant_development','data_science','solutions_architect','forward_deployed','software_engineering','related_technical']){
  assert(Object.hasOwn(jobCategories,category));assert.equal(parseDecision({...decision,categories:[category]},job).accepted,true);
 }
 assert(ruleRejection({...job,title:'Senior Solutions Architect'}));assert(localShortlist({...job,title:'Data Scientist',description:'Requirements: minimum 5 years of professional experience.'}).reason);
 assert(ruleRejection({...job,title:'Forward Deployed Engineer Intern',location:'London, United Kingdom'}));
});

test('Expanded prompt favors related technical roles while keeping career, country and evidence rules',async t=>{
 const {db,sqlite}=database();let calls=0;t.mock.method(globalThis,'fetch',async(_url,init)=>{
  calls++;const prompt=JSON.parse(init.body).messages[0].content;
  for(const text of ['Favor recall','quant_development','data_science','solutions_architect','forward_deployed','related_technical','usSponsorship','OPT/CPT','internship, new_grad or junior'])assert(prompt.includes(text),text);
  assert(!prompt.includes('data analyst/science-only'));return response(decision);
 });
 try{assert.equal((await createJobClassifier(db,config).evaluate({...job,title:'Solutions Architect - New Grad'})).accepted,true);assert.equal(calls,1);}finally{sqlite.close();}
});

test('Old rejection caches are reconsidered; valid old approvals avoid another paid request',async t=>{
 const {db,sqlite}=database();let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return response(decision);});
 try{
  const legacy=await classificationKey(job,config.model,null),current=await classificationKey(job,config.model);assert.notEqual(current,legacy);
  const insert=sqlite.prepare('INSERT OR REPLACE INTO job_evaluations(cache_key,decision_json,model,created_at,expires_at) VALUES(?,?,?,?,?)');
  insert.run(legacy,JSON.stringify({accepted:false,reason:'Old strict role policy'}),config.model,new Date().toISOString(),'2099-01-01T00:00:00Z');
  assert.equal((await createJobClassifier(db,config).evaluate(job)).accepted,true);assert.equal(calls,1);
  sqlite.prepare('DELETE FROM job_evaluations WHERE cache_key=?').run(current);
  insert.run(legacy,JSON.stringify(decision),config.model,new Date().toISOString(),'2099-01-01T00:00:00Z');
  const classifier=createJobClassifier(db,config);assert.equal((await classifier.evaluate(job)).accepted,true);assert.equal(calls,1);assert.equal(classifier.metrics.cacheHits,1);
 }finally{sqlite.close();}
});

test('US sponsorship annotations require an affirmative, verbatim role-specific visa statement',()=>{
 for(const text of ['We offer visa sponsorship for this position.','H-1B visa sponsorship is available for this role.','We can sponsor an H1B visa for this position.','We sponsor work visas for this position.','本美国岗位提供工作签证赞助。']){
  const sponsored={...job,description:job.description+'\n'+text};
  const analysis=parseDecision({...decision,usSponsorship:{available:true,evidence:text}},sponsored);
  assert.equal(analysis.usSponsorship?.available,true,text);assert.equal(analysis.usSponsorship.evidence,text);
  assert.equal(readAnalysis(decision,sponsored.description,sponsored.location).usSponsorship?.available,true,'Already approved jobs can be annotated locally');
 }
 for(const text of ['We do not provide visa sponsorship.','Visa sponsorship is not available for this role.','Must work without visa sponsorship now or in the future.','OPT and CPT candidates are welcome.','We provide conference sponsorship.','Visa provides conference sponsorship.','The company previously sponsored H1B visas.','In the past we provided H1B visa sponsorship.','Visa sponsorship may be considered.','H1B visa sponsorship is available in our UK office.']){
  const sponsored={...job,description:job.description+'\n'+text};
  assert.equal(parseDecision({...decision,usSponsorship:{available:true,evidence:text}},sponsored).usSponsorship,undefined,text);
 }
 const text='We offer visa sponsorship for this position.';
 assert.equal(confirmedUsSponsorship(text,['CN'],{available:true,evidence:text},'Beijing, China'),null);
 assert.equal(confirmedUsSponsorship(text+'\nThis role does not provide visa sponsorship.',['US']),null);
 assert.equal(confirmedUsSponsorship('Some other original text.',['US'],{available:true,evidence:text}),null);
 assert.equal(confirmedUsSponsorship(text,['US'],null,'United States; United Kingdom'),null,'Mixed-country sponsorship needs explicit US scope');
 assert(confirmedUsSponsorship('US positions offer H1B visa sponsorship.',['US'],null,'US; UK'));
 assert.equal(parseDecision({...decision,usSponsorship:{available:true,evidence:'Invented sponsorship'}},job).accepted,true,'Invalid annotation must not reject a valid job');
 assert.equal(readAnalysis({...decision,usSponsorship:{available:true,evidence:'Invented sponsorship'}},job.description,job.location).usSponsorship,undefined);
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
