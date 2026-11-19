import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadLocalTypeScript} from '../scripts/load-local-typescript.mjs';
const {githubListingsUrl,parseCommunityListings,parseSimplifyDetail,githubJobs}=loadLocalTypeScript('lib/community-crawlers.ts');
const {normalizeSource,crawlSource}=loadLocalTypeScript('lib/crawler.ts');
const {dayWindow,withCrawlWindow}=loadLocalTypeScript('lib/crawl-window.ts');
const {withSyncSignal}=loadLocalTypeScript('lib/sync-control.ts');
const window=dayWindow(new Date('2026-11-18T12:00:00Z'));
const source={id:1,name:'Community jobs',url:'https://github.com/SimplifyJobs/Summer2027-Internships',adapter:'auto'};
const uid=i=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
const listing=(i,extra={})=>({id:uid(i),company_name:'Example '+i,title:'Backend Intern',locations:['New York, NY, USA'],url:`https://employer.example/jobs/${i}?utm_source=github`,active:true,is_visible:true,source:'Simplify',date_posted:1795000000+i,...extra});
const posting=(i,extra={})=>({id:uid(i),title:'Backend Intern',description:'<p>Internship building backend services with Go and PostgreSQL.</p>',locations:[{value:'New York, NY, USA',country:'United States'}],job:{company:{name:'Example '+i}},active:true,visible:true,archive:false,start_date:'2026-11-18T12:00:00Z',updated_date:'2026-11-18T12:00:00Z',date_display:{kind:'updated',date:'2026-11-18T12:00:00Z'},...extra});
const page=d=>`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{jobPosting:d}}})}</script>`;
const response=data=>Response.json(data);
async function mocked(fetcher,run){const old=globalThis.fetch;globalThis.fetch=fetcher;try{return await withCrawlWindow(window,run);}finally{globalThis.fetch=old;}}

test('GitHub and Simplify list links choose the public JSON adapter without an API token',()=>{
 const raw='https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json';
 for(const input of [source.url,source.url+'/',source.url+'/blob/dev/.github/scripts/listings.json',raw,'https://simplify.jobs/l/Top-Summer-Internships-2027']){assert.equal(normalizeSource(input).adapter,'github_jobs');assert.equal(githubListingsUrl(input),raw);}
 assert.match(githubListingsUrl('https://github.com/SimplifyJobs/New-Grad-Positions'),/New-Grad-Positions\/dev/);
 assert.match(githubListingsUrl('https://github.com/example/cs-jobs/blob/main/jobs.json'),/example\/cs-jobs\/main\/jobs.json/);
 assert.throws(()=>githubListingsUrl('https://github.com/example/cs-jobs'),/职位文件/);
 assert.throws(()=>githubListingsUrl('https://github.com/example/cs-jobs/blob/main/README.md'),/职位文件/);
 assert.throws(()=>githubListingsUrl('http://github.com/SimplifyJobs/New-Grad-Positions'),/HTTPS/);
});

test('Community metadata ignores closed/hidden entries, sorts inclusion dates and keeps newest duplicates',()=>{
 const rows=parseCommunityListings([listing(1),listing(2,{active:false}),listing(3,{is_visible:false}),listing(4),listing(9,{url:listing(1).url,date_posted:1795999999})]);
 assert.deepEqual(rows.map(r=>r.id),[uid(9),uid(4)]);assert.equal(rows[0].url,'https://employer.example/jobs/1');
 assert.equal(parseCommunityListings([listing(5,{url:'http://employer.example/jobs/5'})]).length,1);
 for(const bad of [{jobs:[]},[listing(1,{locations:null})],[listing(1,{active:'yes'})],[listing(1,{url:'javascript:alert(1)'})]])assert.throws(()=>parseCommunityListings(bad),/结构/);
});

test('Simplify reads the original JD and work locations, never update timestamps or generated summaries',()=>{
 const detail=posting(1,{description:'<p>Original JD requires Go.</p>',requirements:['AI-generated Python summary'],min_salary:20,max_salary:30,currency_type:'USD'});
 const job=parseSimplifyDetail(page(detail),uid(1),parseCommunityListings([listing(1)])[0]);
 assert.equal(job.postedAt,new Date(listing(1).date_posted*1000).toISOString());assert.equal(job.dateKind,'listed');assert.equal(job.description,'Original JD requires Go.');assert(!job.description.includes('Python'));assert.equal(job.canonicalUrl,'https://employer.example/jobs/1');assert.match(job.location,/United States/);assert.equal(job.salary,'USD 20–30');
 assert.equal(parseSimplifyDetail(page(posting(1,{active:false})),uid(1)),null);
 assert.equal(parseSimplifyDetail(page(posting(1,{archive:true})),uid(1)),null);
 assert.throws(()=>parseSimplifyDetail(page(posting(1)),uid(2)),/结构/);
 assert.throws(()=>parseSimplifyDetail(page(posting(1,{description:''})),uid(1)),/缺少/);
});

test('ATS application forms and board aliases normalize to posting URLs for cross-source deduplication',()=>{
 const cases=[
  [`https://jobs.ashbyhq.com/example/${uid(1)}/application?embed=true`,`https://jobs.ashbyhq.com/example/${uid(1)}`],
  [`https://jobs.lever.co/example/${uid(1)}/apply`,`https://jobs.lever.co/example/${uid(1)}`],
  ['https://apply.workable.com/example/j/ABC123/apply/?utm_source=simplify','https://apply.workable.com/example/j/ABC123'],
  ['https://boards.greenhouse.io/example/jobs/123?gh_src=simplify','https://job-boards.greenhouse.io/example/jobs/123'],
 ];
 for(const [url,expected]of cases)assert.equal(parseCommunityListings([listing(1,{url})])[0].url,expected);
 // Preserve job-identifying query parameters on custom company career sites.
 assert.equal(parseCommunityListings([listing(1,{url:'https://employer.example/careers?gh_jid=123&utm_source=simplify'})])[0].url,'https://employer.example/careers?gh_jid=123');
});

test('A source loads only fifty distinct latest unknown-date jobs, preserves employer links and never calls AI',async()=>{
 const urls=[];
 const jobs=await mocked(async url=>{urls.push(String(url));if(String(url).includes('raw.githubusercontent'))return response(Array.from({length:80},(_,i)=>listing(i+1)));const id=String(url).split('/').at(-1),i=Number(id.split('-').at(-1));return new Response(page(posting(i)));},()=>crawlSource(source));
 assert.equal(jobs.length,50);assert.equal(urls.length,51);assert.equal(jobs[0].externalId,uid(80));assert.equal(jobs.at(-1).externalId,uid(31));assert(jobs.every(j=>j.dateKind==='listed'&&j.description.includes('PostgreSQL')));assert(urls.every(url=>url.includes('raw.githubusercontent.com')||url.startsWith('https://simplify.jobs/p/')));
});

test('Fallback retrieves a single ATS JD and excludes verified old publication dates',async()=>{
 const rows=[listing(1,{source:'community',url:'https://job-boards.greenhouse.io/example/jobs/123'}),listing(2,{source:'community',url:'https://jobs.lever.co/example/'+uid(2)})];const urls=[];
 const jobs=await mocked(async url=>{urls.push(String(url));if(String(url).includes('raw.githubusercontent'))return response(rows);if(String(url).includes('greenhouse'))return response({title:'Backend Intern',content:'<p>Go backend internship</p>',first_published:'2026-11-18T12:00:00Z'});return response({text:'Backend Intern',descriptionPlain:'Old internship in Go',createdAt:Date.parse('2026-11-17T12:00:00Z')});},()=>crawlSource(source));
 assert.equal(jobs.length,1);assert.equal(jobs[0].postedAt,'2026-11-18T12:00:00Z');assert.equal(urls.length,3);assert(jobs.warnings.some(w=>w.includes('纽约当天')));
});

test('Partial failures are explicit and an entirely blocked detail source cannot look healthy',async()=>{
 const rows=[listing(1),listing(2)];
 const partial=await mocked(async url=>String(url).includes('raw.githubusercontent')?response(rows):String(url).endsWith(uid(1))?new Response(page(posting(1))):new Response('Blocked',{status:403}),()=>githubJobs(source));
 assert.equal(partial.length,1);assert(partial.warnings.some(w=>w.includes('部分完成')&&w.includes('HTTP 403')));
 await mocked(async url=>String(url).includes('raw.githubusercontent')?response(rows):new Response('Blocked',{status:403}),async()=>assert.rejects(()=>githubJobs(source),/详情均未完成/));
 await mocked(async()=>new Response('rate limited',{status:403}),async()=>assert.rejects(()=>githubJobs(source),/HTTP 403/));
 await mocked(async()=>response([]),async()=>assert.equal((await githubJobs(source)).length,0));
});

test('Cancellation aborts detail requests and cannot be swallowed by partial-failure reporting',async()=>{
 const controller=new AbortController();
 await mocked(async(url,init)=>{if(String(url).includes('raw.githubusercontent'))return response([listing(1)]);controller.abort();throw init.signal.reason;},async()=>assert.rejects(()=>withSyncSignal(controller.signal,()=>githubJobs(source)),/abort|取消/i));
});
