import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {loadLocalTypeScript} from '../scripts/load-local-typescript.mjs';
const {parseGoogle,parseApple,amazon,eightfold,tencent,comeet}=loadLocalTypeScript('lib/company-crawlers.ts');
const {crawlSource}=loadLocalTypeScript('lib/crawler.ts');
const {createSyncControl,withSyncSignal,syncDelay}=loadLocalTypeScript('lib/sync-control.ts');
const {fetchJson}=loadLocalTypeScript('lib/crawler-http.ts');
const json=body=>Response.json(body);
const source={id:1,name:'Test company',url:'https://example.test/careers',adapter:'auto'};

test('Durable cancel flag stops a running network request, even without a local cancel call',async t=>{
 let requested=false,markStarted;
 const started=new Promise(resolve=>{markStarted=resolve;});
 const control=createSyncControl(async()=>requested,5);
 let fetchCalls=0;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  fetchCalls++;markStarted();
  return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
 });
 try{
  const work=withSyncSignal(control.signal,()=>fetchJson('https://example.test/jobs'));
  const rejected=assert.rejects(work,/用户已取消同步/);
  await started;requested=true;await rejected;
  assert.equal(fetchCalls,1);
 }finally{control.close();}
});

test('Cancellation stops backoff immediately and does not cancel an unrelated run',async()=>{
 const one=createSyncControl(async()=>false),two=createSyncControl(async()=>false);
 try{
  const work=withSyncSignal(one.signal,()=>syncDelay(30000));
  const rejected=assert.rejects(work,/用户已取消同步/);
  one.cancel();await rejected;
  assert.equal(two.signal.aborted,false);
  await withSyncSignal(two.signal,()=>syncDelay(1));
 }finally{one.close();two.close();}
});

test('Cancelled contexts never start new HTTP requests',async t=>{
 const controller=new AbortController();controller.abort(new Error('Cancelled before start'));
 const mocked=t.mock.method(globalThis,'fetch',async()=>json({}));
 await assert.rejects(withSyncSignal(controller.signal,()=>fetchJson('https://example.test/jobs')),/Cancelled before start/);
 assert.equal(mocked.mock.calls.length,0);
});

function syncRoute(runSync){
 const code=ts.transpileModule(fs.readFileSync('app/api/sync/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function('require','exports',code)(()=>({runSync}),exports);return exports.POST;
}

test('Sync sends an immediate uncompressed heartbeat and preserves JSON compatibility',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});
 const response=await syncRoute(()=>pending)();
 assert.equal(response.headers.get('Content-Encoding'),'identity');
 assert.match(response.headers.get('Cache-Control'),/no-transform/);
 const reader=response.body.getReader();const first=await reader.read();
 assert.equal(new TextDecoder().decode(first.value),'\n');
 finish({status:'success',jobsAdded:2});
 let body='';for(;;){const chunk=await reader.read();if(chunk.done)break;body+=new TextDecoder().decode(chunk.value);}
 assert.equal(JSON.parse(body).jobsAdded,2);
});

test('Sync stream exposes lock/errors as a JSON error, without hanging the connection',async()=>{
 const response=await syncRoute(async()=>{throw new Error('Already running');})();
 assert.equal((await response.json()).error,'Already running');
});

test('Google reads embedded JSON without executing JavaScript, preserves full JD and posting timestamp',()=>{
 const j=['123','Research Engineer','', [null,'<ul><li>Responsibilities</li></ul>'],[null,'Qualifications'],null,null,'DeepMind',null,[['London, UK']], [null,'Full description'],null,[1794873600]];
 const html=`<script>AF_initDataCallback({key: 'ds:1', hash: '2', data:${JSON.stringify([[j],null,1,20])}, sideChannel: {}});throw new Error('must not execute')</script>`;
 const d=parseGoogle(html,source);
 assert.equal(d.jobs[0].postedAt,'2026-11-17T00:00:00.000Z');assert.equal(d.jobs[0].company,'DeepMind');
 assert.match(d.jobs[0].description,/Full description[\s\S]*Qualifications[\s\S]*Responsibilities/);assert.equal(d.total,1);
 assert.throws(()=>parseGoogle('<html>Captcha</html>',source),/公开职位数据/);
});

test('Greenhouse uses original publication date, never the later content update date',async t=>{
 t.mock.method(globalThis,'fetch',async()=>json({jobs:[{id:'1',title:'Engineer',absolute_url:'https://example.test/1',first_published:'2026-01-01T00:00:00Z',updated_at:'2026-11-17T00:00:00Z',content:'Full JD'}]}));
 const jobs=await crawlSource({...source,url:'https://job-boards.greenhouse.io/test',adapter:'greenhouse'});
 assert.equal(jobs.length,0,'An old job updated today must not be fetched as a new posting');
});

test('Apple safely decodes double JSON and escaped strings',()=>{
 const data={loaderData:{jobDetails:{jobsData:{postingTitle:'Engineer "AI"',description:'<p>Full JD</p>'}}}};
 const html=`window.__staticRouterHydrationData = JSON.parse(${JSON.stringify(JSON.stringify(data))});`;
 assert.equal(parseApple(html).jobDetails.jobsData.postingTitle,'Engineer "AI"');
});

test('Amazon paginates, ignores expired posts, and includes requirements in JD',async t=>{
 const calls=[];
 t.mock.method(globalThis,'fetch',async url=>{calls.push(String(url));const offset=new URL(url).searchParams.get('offset');return json({hits:101,jobs:offset==='0'?[{id_icims:'a',title:'Engineer',job_path:'/en/jobs/a/engineer',description:'Description',basic_qualifications:'Requirements',posted_date:new Date().toISOString()}]:[{id_icims:'b',title:'Old',job_path:'/en/jobs/b/old',posted_date:'2000-01-01'}]});});
 const jobs=await amazon(source);assert.equal(jobs.length,1);assert.equal(calls.length,2);assert.match(jobs[0].description,/Requirements/);
 assert.equal(jobs[0].canonicalUrl,'https://www.amazon.jobs/en/jobs/a/engineer');
});

test('Eightfold preserves collected jobs and reports partial results when later pages are rate limited',async t=>{
 t.mock.method(globalThis,'fetch',async url=>{
  const u=new URL(url);
  if(u.pathname.includes('position_details'))return json({data:{name:'Engineer',jobDescription:'Full JD',publicUrl:'https://example.test/careers/job/1',atsJobId:'1',postedTs:Date.now()/1000}});
  if(u.searchParams.get('start')==='0')return json({data:{count:20,positions:[{id:1,postedTs:Date.now()/1000}]}});
  return new Response('Rate limited',{status:429,headers:{'Retry-After':'61'}});
 });
 const jobs=await eightfold(source,'example.test');assert.equal(jobs.length,1);assert.match(jobs.warnings[0],/部分抓取.*HTTP 429/);
});

test('Tencent API errors cannot be mistaken for an empty successful source',async t=>{
 t.mock.method(globalThis,'fetch',async()=>json({Code:500,Message:'Unavailable'}));
 await assert.rejects(()=>tencent(source),/腾讯接口错误/);
});

test('Comeet fetches only the first fifty undated jobs and never treats updates as publication',async t=>{
 let details=0;t.mock.method(globalThis,'fetch',async url=>{
  const u=new URL(url);if(u.pathname.includes('/positions/')){details++;return json({uid:u.pathname.split('/').at(-1),name:'Engineer',url_active_page:'https://example.test/'+details,details:[{name:'Description',value:'<p>JD</p>'}],time_updated:new Date().toISOString()});}
  return String(url).includes('comeet.co')?json(Array.from({length:80},(_,i)=>({uid:String(i),name:'Engineer',time_updated:new Date().toISOString()}))):new Response("var CAREER_API_URL = 'https://www.comeet.co/careers-api/2.0/company/test/positions?token=public-site-token';");
 });
 const jobs=await comeet(source);assert.equal(jobs.length,50);assert.equal(details,50);assert(jobs.every(j=>j.postedAt===null&&j.description.includes('JD')));
});
