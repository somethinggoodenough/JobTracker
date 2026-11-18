import assert from 'node:assert/strict';
const base=process.argv[2]||'http://127.0.0.1:4173';
async function json(path){const r=await fetch(base+path);assert.equal(r.status,200,await (r.ok?Promise.resolve(''):r.text()));return r.json();}
const ids=new Set();let fifth;
const initial=await json('/api/jobs');
const checkedPages=Math.min(5,initial.pagination.totalPages);
for(let page=1;page<=checkedPages;page++){
 const d=await json(`/api/jobs?page=${page}`);
 assert.equal(d.pagination.pageSize,50);assert.equal(d.pagination.page,page);
 assert.equal(d.jobs.length,Math.min(50,d.pagination.total-(page-1)*50));
 assert(d.jobs.every(job=>job.classification?.accepted),'Only reviewed eligible jobs may be listed');
 for(const job of d.jobs){assert(!ids.has(job.id),'不同页不应重复');ids.add(job.id);}
 if(page===checkedPages)fifth=d;
}
assert.equal(ids.size,Math.min(250,initial.pagination.total),'应能读取所有已筛选职位，最多检查前 5 页');
const candidate=[...fifth.jobs].sort((a,b)=>b.title.length-a.title.length)[0];
if(candidate){const matches=await json(`/api/jobs?q=${encodeURIComponent(candidate.title)}`);assert(matches.jobs.some(j=>j.id===candidate.id),'搜索应覆盖当前页之外的全部记录');}
const invalid=await json('/api/jobs?page=-1');assert.equal(invalid.pagination.page,1);
const last=await json('/api/jobs?page=999999');assert.equal(last.pagination.page,last.pagination.totalPages);assert(last.jobs.length<=50);
const today=await json('/api/jobs?period=today');
assert(today.jobs.every(j=>j.publication_verified===1&&Date.parse(j.posted_at)>=Date.parse(today.today.start)&&Date.parse(j.posted_at)<Date.parse(today.today.end)));
const history=await json('/api/sync/runs');assert(history.runs.length<=20);
for(const path of ['/','/applications','/sources','/runs']){
 const r=await fetch(base+path);assert.equal(r.status,200);
 const html=await r.text();assert(html.includes('主目录'));for(const href of ['/applications','/sources','/runs'])assert(html.includes(`href="${href}"`));
 console.log('Route OK',path);
}
console.log(JSON.stringify({pass:true,uniqueJobsAcrossFivePages:ids.size,total:fifth.pagination.total,totalPages:fifth.pagination.totalPages,todayTotal:today.pagination.total}));
