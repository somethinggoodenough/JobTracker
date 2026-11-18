import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {loadLocalTypeScript} from '../scripts/load-local-typescript.mjs';
const {DEFAULT_SCREENING,AI_RESPONSE_CONTRACT}=loadLocalTypeScript('lib/screening-defaults.ts');
const {parseScreeningInput,screeningSettings,saveScreeningSettings,ScreeningConflictError}=loadLocalTypeScript('lib/screening-settings.ts');
const {withScreeningRules,currentScreeningRules}=loadLocalTypeScript('lib/screening-context.ts');
const {localShortlist}=loadLocalTypeScript('lib/local-shortlist.ts');
const {ruleRejection,classificationKey,createJobClassifier,parseDecision}=loadLocalTypeScript('lib/job-classifier.ts');
const {bossCampus}=loadLocalTypeScript('lib/expanded-crawlers.ts');
const fresh=()=>structuredClone(DEFAULT_SCREENING);
const input=()=>({...fresh(),version:1});
const job={externalId:'1',company:'Fixture',title:'Backend Engineer New Grad',location:'United States',canonicalUrl:'https://employer.test/1',description:'New Grad role. Build backend systems with Python. Requirements: 0-2 years experience.'};
const decision={accepted:true,categories:['backend_distributed'],careerLevel:'new_grad',countries:['US'],techStack:[{name:'Python',evidence:'with Python'}],roleEvidence:'Backend Engineer',levelEvidence:'New Grad',locationEvidence:'United States',reason:'相关应届岗位'};
function database(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+file,'utf8'));
 const db={prepare(sql){let values=[];const statement={bind(...v){values=v;return statement;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return{results:sqlite.prepare(sql).all(...values)};},async run(){const r=sqlite.prepare(sql).run(...values);return{meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};return statement;}};
 return{db,sqlite};
}

test('Screening settings persist independently of budget, preserve jobs, and reject stale saves',async()=>{
 const {db,sqlite}=database();try{
  const before=await screeningSettings(db);assert.deepEqual(before.coarse,DEFAULT_SCREENING.coarse);assert.equal(before.aiPrompt,DEFAULT_SCREENING.aiPrompt);
  const budget=sqlite.prepare('SELECT * FROM ai_settings').all();
  const custom={...before,aiPrompt:'Prefer backend and quantitative engineering roles.',coarse:{...before.coarse,requiredKeywords:['C++',' C++ '],maxRequiredYears:null}};
  delete custom.updatedAt;
  const saved=await saveScreeningSettings(db,custom);assert.equal(saved.version,2);assert.deepEqual(saved.coarse.requiredKeywords,['C++']);assert.equal(saved.coarse.maxRequiredYears,null);
  assert.equal((await screeningSettings(db)).aiPrompt,custom.aiPrompt);assert.deepEqual(sqlite.prepare('SELECT * FROM ai_settings').all(),budget);
  await assert.rejects(()=>saveScreeningSettings(db,custom),ScreeningConflictError);assert.equal((await screeningSettings(db)).version,2);
 }finally{sqlite.close();}
});

test('Prompt and coarse settings validate types and bounded literal keywords',()=>{
 for(const patch of [{aiPrompt:''},{aiPrompt:'x'.repeat(16001)},{version:0},{version:'1'},{coarse:{...fresh().coarse,rejectSeniorTitles:'false'}},{coarse:{...fresh().coarse,maxRequiredYears:2.5}},{coarse:{...fresh().coarse,maxRequiredYears:-1}},{coarse:{...fresh().coarse,requiredKeywords:['x'.repeat(81)]}},{coarse:{...fresh().coarse,extra:true}}])assert.throws(()=>parseScreeningInput({...input(),...patch}));
 assert.deepEqual(parseScreeningInput({...input(),coarse:{...fresh().coarse,requiredKeywords:['C++','[Python]']}}).coarse.requiredKeywords,['C++','[Python]']);
});

test('Each coarse condition changes actual eligibility and keyword matching stays literal',()=>{
 const senior={...job,title:'Senior Backend Engineer'};assert(ruleRejection(senior));assert.equal(ruleRejection(senior,{...fresh().coarse,rejectSeniorTitles:false}),null);
 assert.equal(ruleRejection({...job,location:'Canada'},{...fresh().coarse,rejectForeignLocations:false}),null);
 const coarse={...fresh().coarse,requiredKeywords:['C++'],excludedKeywords:['unpaid']};
 assert(ruleRejection(job,coarse));assert.equal(ruleRejection({...job,description:job.description+' C++'},coarse),null);
 assert(ruleRejection({...job,description:job.description+' C++ unpaid'},coarse));
 const experienced={...job,description:'Requirements: minimum 5 years of professional experience. Build Python systems.'};
 assert(localShortlist(experienced).reason);assert.equal(localShortlist(experienced,{...fresh().coarse,maxRequiredYears:5}).reason,null);
 const generic={...job,title:'Backend Engineer',description:'Build backend systems with Python.'};
 assert(localShortlist(generic).reason);assert.equal(localShortlist(generic,{...fresh().coarse,requireEarlyCareerSignals:false}).reason,null);
 const adjacent={...job,title:'Geospatial Intern',description:'Develop geospatial workflows.'};
 assert(localShortlist(adjacent).reason);assert.equal(localShortlist(adjacent,{...fresh().coarse,extraTechnicalKeywords:['geospatial']}).reason,null);
 const other={...job,title:'Recruiter Intern',description:'Recruit people.'};
 assert(localShortlist(other).reason);assert.equal(localShortlist(other,{...fresh().coarse,rejectNonTechnical:false,requireTechnicalSignals:false}).reason,null);
});

test('Concurrent sync contexts isolate coarse rules and retain their own snapshots',async()=>{
 const a=fresh(),b=fresh();a.coarse.requiredKeywords=['CUDA'];b.coarse.requiredKeywords=['Python'];
 const result=await Promise.all([a,b].map(r=>withScreeningRules(r,async()=>{await new Promise(resolve=>setTimeout(resolve,5));return ruleRejection(job);})));assert(result[0]);assert.equal(result[1],null);assert.equal(currentScreeningRules(),DEFAULT_SCREENING);
});

test('Prompt and filter changes invalidate approvals/rejections while timestamps do not affect cache identity',async()=>{
 const a=fresh(),b=fresh();b.aiPrompt+='\nPrefer Python.';
 assert.notEqual(await classificationKey(job,'model',undefined,a),await classificationKey(job,'model',undefined,b));
 const c=fresh();c.coarse.requireEarlyCareerSignals=false;assert.notEqual(await classificationKey(job,'model',undefined,a),await classificationKey(job,'model',undefined,c));
 assert.equal(await classificationKey(job,'model',undefined,a),await classificationKey(job,'model',undefined,{...a,updatedAt:'later',version:20}));
});

test('Custom prompt reaches DeepSeek and cannot reuse an approval from another prompt',async t=>{
 const {db,sqlite}=database();let calls=0;const settings=fresh();settings.aiPrompt='Prioritize Python backend roles. Use the application schema.';
 t.mock.method(globalThis,'fetch',async(_url,init)=>{calls++;const body=JSON.parse(init.body);assert(body.messages[0].content.startsWith(settings.aiPrompt));assert(body.messages[0].content.includes(AI_RESPONSE_CONTRACT));return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(decision)}}],usage:{}});});
 try{
  sqlite.prepare('INSERT INTO job_evaluations VALUES(?,?,?,?,?)').run(await classificationKey(job,'fixture-model'),JSON.stringify(decision),'fixture-model',new Date().toISOString(),'2099-01-01');
  const config={apiKey:'fixture-only',model:'fixture-model',screening:settings};
  assert.equal((await createJobClassifier(db,config).evaluate(job)).accepted,true);assert.equal(calls,1);
  assert.equal((await createJobClassifier(db,config).evaluate(job)).accepted,true);assert.equal(calls,1);
  assert.throws(()=>parseDecision({...decision,techStack:[{name:'CUDA',evidence:'not in JD'}]},job,settings.coarse));
 }finally{sqlite.close();}
});

test('BOSS own campus reads fifty undated full JDs without confusing update/end dates with publication',async t=>{
 t.mock.method(globalThis,'fetch',async(_url,init)=>{const b=JSON.parse(init.body);assert.equal(b.pageSize,50);assert.equal(b.encryptPageId,'official-page');return Response.json({code:0,zpData:{count:66,hasMore:true,geekVolunteerVOS:Array.from({length:66},(_,i)=>({encryptJobId:String(i),jobName:'Java Intern',orgName:'BOSS直聘',postDescription:'Build backend systems and distributed services using Java and SQL.',addressName:'中国北京',url:`https://www.zhipin.com/campus/job/${i}`,updateTimeStr:'2026-11-18',endTime:'2099-01-01'}))}});});
 const jobs=await bossCampus({id:1,name:'Boss直聘（公司校招）',url:'https://www.zhipin.com/campus/pc/',adapter:'boss_campus'},'official-page');assert.equal(jobs.length,50);assert(jobs.every(j=>j.postedAt===null));assert.match(jobs[0].description,/Java and SQL/);assert.equal(jobs[0].company,'BOSS直聘');
});
