import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv} from 'node:crypto';
import {loadLocalTypeScript} from '../scripts/load-local-typescript.mjs';
const {feishu,antgroup,moka,decodeMoka,netease,salesforce,tiktok}=loadLocalTypeScript('lib/additional-crawlers.ts');
const {assignedJson,careerSession}=loadLocalTypeScript('lib/career-session.ts');
const {crawlSource,normalizeSource}=loadLocalTypeScript('lib/crawler.ts');
const {withCrawlWindow,dayWindow}=loadLocalTypeScript('lib/crawl-window.ts');
const window=dayWindow(new Date('2026-11-17T12:00:00Z'));
const source={id:800,name:'Fixture',url:'https://company.test/campus/position/list',adapter:'auto'};
const today=fn=>withCrawlWindow(window,fn);
const row=(id,date=null)=>({id:String(id),title:'Backend Engineer Intern',publish_time:date,description:'Responsibilities: build backend services.',requirement:'Python and SQL required',city_list:[{name:'北京'}],recruit_type:{name:'实习',parent:{name:'校招'}}});

test('Public employer board URLs select their dedicated adapter automatically',()=>{
 for(const [url,adapter]of [['https://modelbest.jobs.feishu.cn/campus/position/list','feishu'],['https://jobs.bytedance.com/campus/position/list','feishu'],['https://iflytek.zhiye.com/jobs','beisen'],['https://app.mokahr.com/campus-recruitment/step/94905','moka'],['https://jobs.gem.com/groq','gem'],['https://lifeattiktok.com/search','tiktok']])assert.equal(normalizeSource(url).adapter,adapter);
});

test('SSR JSON parser preserves quoted undefined and never executes page code',()=>{
 assert.deepEqual(assignedJson('window.DATA = {"missing":undefined,"text":"undefined } ; \\\""}; throw new Error("bad")','window.DATA'),{missing:null,text:'undefined } ; "'});
 assert.throws(()=>assignedJson('window.DATA = {notJson:()=>secret()};','window.DATA'));
});

test('Anonymous sessions retain redirect cookies and reject insecure redirects',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url,headers:init.headers});return calls.length===1?new Response('',{status:302,headers:{location:'https://company.test/jobs','set-cookie':'visit=anonymous; Path=/; Secure'}}):Response.json({jobs:[]});});
 const session=careerSession();await session.fetch('https://company.test/');assert.equal(calls[1].headers.cookie,'visit=anonymous');
 t.mock.method(globalThis,'fetch',async()=>new Response('',{status:302,headers:{location:'http://company.test/jobs'}}));
 await assert.rejects(()=>careerSession().fetch('https://company.test/'),/HTTPS/);
});

test('Feishu initializes its own CSRF token and limits undated jobs to fifty across pages',async t=>{
 const bodies=[];t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(url.endsWith('/csrf/token'))return Response.json({code:0,data:{token:'fresh-anonymous-token'}});
  if(url.includes('/search/job/posts')){assert.equal(init.headers['x-csrf-token'],'fresh-anonymous-token');const b=JSON.parse(init.body);bodies.push(b);return Response.json({code:0,data:{count:150,job_post_list:Array.from({length:50},(_,i)=>row(i+b.offset))}});}
  return new Response('<html>Employer board</html>');
 });
 const jobs=await today(()=>feishu(source,'6'));assert.equal(jobs.length,50);assert.equal(bodies.length,1);
 assert.match(jobs[0].description,/校招.*实习/);assert.match(jobs[0].description,/Python and SQL/);assert.equal(jobs[0].postedAt,null);
});

test('Feishu API failure cannot become a healthy zero-job source',async t=>{
 t.mock.method(globalThis,'fetch',async(url)=>url.endsWith('/csrf/token')?Response.json({code:0,data:{token:'fresh'}}):url.includes('/search/job/posts')?Response.json({code:500,message:'Unavailable'}):new Response('board'));
 await assert.rejects(()=>feishu(source,'6'),/Unavailable/);
});

test('Recruitment metadata cannot masquerade as a full job description',async t=>{
 t.mock.method(globalThis,'fetch',async(url)=>url.endsWith('/csrf/token')?Response.json({code:0,data:{token:'fresh'}}):url.includes('/search/job/posts')?Response.json({code:0,data:{count:1,job_post_list:[{...row(1),description:'',requirement:''}]}}):new Response('board'));
 await assert.rejects(()=>feishu(source,'6'),/不能替代完整 JD/);
});

test('Ant uses its verified twenty-row page size and finds today jobs after an older unsorted page',async t=>{
 const bodies=[];t.mock.method(globalThis,'fetch',async(_url,init)=>{const b=JSON.parse(init.body);bodies.push(b);const first=Array.from({length:20},(_,i)=>({id:i+1,name:'Backend Engineer',workLocations:['北京'],publishTime:'2026-11-16T10:00Z',description:'Old duties',requirement:'Old requirements'}));return Response.json({success:true,totalCount:21,content:b.pageIndex===1?first:[{id:21,name:'Backend Intern',workLocations:['北京'],publishTime:'2026-11-17T12:00Z',description:'Build services',requirement:'Python'}]});});
 const jobs=await today(()=>antgroup(source));assert.equal(jobs.length,1);assert.equal(bodies.length,2);assert(bodies.every(b=>b.pageSize===20));assert.match(jobs[0].description,/Build services[\s\S]*Python/);
});

test('Moka decodes the public envelope and rejects malformed transport parameters',()=>{
 const key='0123456789abcdef',iv='abcdef0123456789',cipher=createCipheriv('aes-128-cbc',Buffer.from(key),Buffer.from(iv));
 const plaintext={code:0,success:true,data:{jobs:[{title:'AI Intern'}]}},data=Buffer.concat([cipher.update(JSON.stringify(plaintext)),cipher.final()]).toString('base64');
 assert.deepEqual(decodeMoka({data,necromancer:key},iv),plaintext);assert.throws(()=>decodeMoka({data,necromancer:'changed'},iv),/编码/);
});

test('Moka uses publishedAt in China time, never updatedAt, and fetches complete details',async t=>{
 let detailCalls=0;t.mock.method(globalThis,'fetch',async(url)=>{
  if(url.endsWith('/website/jobs'))return Response.json({code:0,success:true,data:{jobStats:{total:2},jobs:[{id:'today',title:'AI Intern',publishedAt:'2026-11-18T01:00:00',updatedAt:'2026-11-18T02:00:00'},{id:'old',title:'Old',publishedAt:'2026-10-01T12:00:00',updatedAt:'2026-11-17T12:00:00'}]}});
  if(url.endsWith('/website/job')){detailCalls++;return Response.json({code:0,data:{jobDescription:'<p>Build AI systems with Python</p>',commitment:'实习',locations:[{country:'中国',provinceName:'上海市'}]}});}
  return new Response('<input id="init-data" value="{&quot;aesIv&quot;:&quot;abcdef0123456789&quot;}">');
 });
 const jobs=await today(()=>moka({...source,url:'https://app.mokahr.com/campus-recruitment/step/94905'},'step'));
 assert.equal(jobs.length,1);assert.equal(detailCalls,1);assert.equal(jobs[0].postedAt,'2026-11-17T17:00:00.000Z');assert.match(jobs[0].description,/Python/);assert.match(jobs[0].location,/中国/);
});

test('NetEase does not mislabel an updateTime as a publication date',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({code:200,data:{list:[{id:1,name:'Backend Intern',workPlaceNameList:['北京'],description:'Full duties',requirement:'Python',updateTime:Date.now()}]}}));
 const jobs=await netease(source);assert.equal(jobs[0].dateKind,'updated');assert(Number.isFinite(Date.parse(jobs[0].postedAt)));
});

test('TikTok uses its public website identifier and retains country evidence',async t=>{
 t.mock.method(globalThis,'fetch',async(_url,init)=>{assert.equal(init.headers['website-path'],'tiktok');return Response.json({code:0,data:{job_post_list:[{...row(1),city_info:{en_name:'Seattle',parent:{en_name:'United States'}},recruit_type:{en_name:'Intern'}}]}});});
 const jobs=await tiktok(source);assert.match(jobs[0].location,/Seattle, United States/);assert.match(jobs[0].canonicalUrl,/lifeattiktok/);
});

test('Salesforce retains explicit country evidence and skips foreign-only detail downloads',async t=>{
 const entry={Job_Requisition_Ref_ID:'JR1',Job_Posting_Title:'Backend Engineer Intern',Job_Requisition_Primary_Location:'Shanghai',Countries:['China'],Time_Type:'Full time',Employee_Type:'Intern',External_Job_Posting_Start_Date:'2026-11-17',External_Job_Posting_Site:'https://example.test/jobs/1',Job_Description:'<p>Full backend job description with Python</p>'};
 let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;return Response.json({Total_Jobs:2,Count:2,Report_Entry:[entry,{...entry,Job_Requisition_Ref_ID:'JR2',Countries:['United Kingdom'],Job_Description:''}]});});
 const jobs=await today(()=>salesforce(source));assert.equal(jobs.length,1);assert.equal(requests,1);assert.match(jobs[0].location,/Shanghai.*China/);assert.match(jobs[0].employmentType,/Intern/);
});

test('Workable validates its schema and retrieves requirements plus country',async t=>{
 const published='2026-11-17T12:00Z';t.mock.method(globalThis,'fetch',async(url)=>url.includes('/api/v3/')?Response.json({results:[{shortcode:'ABC',title:'Backend Intern',published,location:{city:'New York',country:'United States'}}],total:1}):Response.json({description:'Build services',requirements:'Python and SQL',benefits:'Health plan'}));
 const jobs=await today(()=>crawlSource({...source,url:'https://apply.workable.com/fixture/',adapter:'workable'}));assert.equal(jobs.length,1);assert.match(jobs[0].description,/Python and SQL/);assert.match(jobs[0].location,/United States/);
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:'invalid account'}));await assert.rejects(()=>crawlSource({...source,url:'https://apply.workable.com/fixture/',adapter:'workable'}),/职位列表/);
});

test('Workday missing details fail visibly instead of silently dropping every job',async t=>{
 t.mock.method(globalThis,'fetch',async(url)=>url.endsWith('/jobs')?Response.json({total:1,jobPostings:[{title:'Backend Intern',postedOn:'Posted Today',externalPath:'/job/1'}]}):Response.json({error:'no details'}));
 await assert.rejects(()=>today(()=>crawlSource({...source,url:'https://fixture.wd1.myworkdayjobs.com/External',adapter:'workday'})),/详情缺失/);
});
