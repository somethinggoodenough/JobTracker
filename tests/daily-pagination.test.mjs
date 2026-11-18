import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadLocalTypeScript} from '../scripts/load-local-typescript.mjs';
const {dayWindow,withCrawlWindow,isInCrawlWindow,currentCrawlWindow,publicationTime}=loadLocalTypeScript('lib/crawl-window.ts');
const {jobQuery,pagination}=loadLocalTypeScript('lib/job-query.ts');
const {crawlSource}=loadLocalTypeScript('lib/crawler.ts');
const {eightfold,tencent}=loadLocalTypeScript('lib/company-crawlers.ts');
const window=dayWindow(new Date('2026-11-17T12:00:00Z'));

test('Today uses New York midnight, excludes yesterday/future, and handles date-only fields',()=>{
 assert.equal(window.start,'2026-11-17T05:00:00.000Z');assert.equal(window.end,'2026-11-18T05:00:00.000Z');
 assert.equal(isInCrawlWindow('2026-11-17T04:59:59Z',window),false);
 assert.equal(isInCrawlWindow(window.start,window),true);assert.equal(isInCrawlWindow(window.end,window),false);
 assert.equal(isInCrawlWindow('2026-11-17',window),true);assert.equal(isInCrawlWindow('2026-11-16',window),false);
 assert.equal(isInCrawlWindow(null,window),false);assert.equal(isInCrawlWindow('invalid',window),false);
 assert.equal(new Date(publicationTime('2026-11-17',window)).toISOString(),window.start);
});
test('Day windows respect 23-hour and 25-hour daylight-saving days',()=>{
 const spring=dayWindow(new Date('2026-03-08T12:00:00Z')),fall=dayWindow(new Date('2026-11-01T12:00:00Z'));
 assert.equal(Date.parse(spring.end)-Date.parse(spring.start),23*3600000);
 assert.equal(Date.parse(fall.end)-Date.parse(fall.start),25*3600000);
});
test('A running crawl retains its day window across async work',async()=>{
 await withCrawlWindow(window,async()=>{await Promise.resolve();assert.equal(currentCrawlWindow().date,'2026-11-17');});
});
test('Pagination is 50 per page and clamps invalid/out-of-range pages',()=>{
 assert.deepEqual(pagination(101,999),{page:3,pageSize:50,total:101,totalPages:3,offset:100});
 assert.equal(pagination(0,1).page,1);assert.equal(pagination(2001,41).offset,2000);
 for(const page of ['-1','abc','Infinity','999999999999999999'])assert.equal(jobQuery(new URL('https://example.test?page='+page)).page,1);
});
test('Search and today filters are parameterized and match count/list consistently',()=>{
 const q=jobQuery(new URL('https://example.test?page=4&period=today&q=100%25_&type=Full-time'),new Date('2026-11-17T12:00Z'));
 assert.equal(q.page,4);assert(q.bindings.includes('100%_'));assert(q.bindings.includes('fulltime'));
 assert(q.where.includes('instr(lower(j.description)'));assert(!q.where.includes('100'));assert(q.bindings.includes(window.start));
});
test('Greenhouse includes today and undated jobs, but never downloads yesterday JD',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async url=>{
  calls.push(String(url));return Response.json(String(url).includes('/jobs/3')?{id:3,title:'Undated',absolute_url:'https://example.test/3',content:'Unknown JD'}:String(url).includes('/jobs/1')?{id:1,title:'Today',absolute_url:'https://example.test/1',first_published:'2026-11-17T13:00:00Z',content:'Full JD'}:{jobs:[
   {id:1,title:'Today',first_published:'2026-11-17T13:00:00Z'},
   {id:2,title:'Old',first_published:'2026-11-16T13:00:00Z'}, {id:3,title:'Undated'}]});
 });
 const result=await withCrawlWindow(window,()=>crawlSource({id:1,name:'Test',url:'https://job-boards.greenhouse.io/test',adapter:'greenhouse'}));
 assert.equal(result.length,2);assert.equal(result[0].description,'Full JD');assert.equal(calls.length,3);
 assert(!calls.some(c=>c.includes('/jobs/2')));assert.equal(result[1].postedAt,null);assert.match(result.warnings[0],/未提供发布日期/);
});
test('Eightfold skips older JD requests and stops after an older sorted page',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async url=>{
  calls.push(String(url));const u=new URL(url);
  if(u.pathname.includes('position_details'))return Response.json({data:{name:'Today',jobDescription:'JD',atsJobId:'1',publicUrl:'https://example.test/1',postedTs:Date.parse('2026-11-17T12:00Z')/1000}});
  return Response.json({data:{count:100,positions:u.searchParams.get('start')==='0'?[{id:1,postedTs:Date.parse('2026-11-17T12:00Z')/1000},{id:2,postedTs:Date.parse('2026-11-16T12:00Z')/1000}]:[{id:3,postedTs:Date.parse('2026-11-16T12:00Z')/1000}]}});
 });
 const result=await withCrawlWindow(window,()=>eightfold({id:1,name:'Test',url:'https://example.test/careers',adapter:'eightfold'},'example.test'));
 assert.equal(result.length,1);assert.equal(calls.length,3);assert(!calls.some(c=>c.includes('position_id=2')||c.includes('position_id=3')));
});
test('Tencent does not mistake last-update time for original publication',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async url=>{calls++;return String(url).includes('ByPostId')?Response.json({Code:200,Data:{Requirement:'JD'}}):Response.json({Code:200,Data:{Count:1,Posts:[{PostId:'1',LastUpdateTime:'2026年11月17日'}]}});});
 const result=await withCrawlWindow(window,()=>tencent({id:1,name:'腾讯',url:'https://careers.tencent.com',adapter:'tencent'}));
 assert.equal(result.length,1);assert.equal(calls,2);assert.equal(result[0].postedAt,null);
});
