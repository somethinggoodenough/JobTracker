import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadLocalTypeScript} from './load-local-typescript.mjs';
const {communitySources}=loadLocalTypeScript('lib/community-crawlers.ts');
const base=process.argv[2]||'http://127.0.0.1:4173';
async function json(path,options){const response=await fetch(base+path,{...options,signal:AbortSignal.timeout(180000)});const data=await response.json();return{response,data};}
const before=(await json('/api/ai/status')).data;
assert(!['running','cancelling'].includes((await json('/api/sync/progress')).data.run?.status),'Wait for active sync and stop the hourly scheduler before verification.');
const results=[];
for(const item of communitySources){
 const started=Date.now();let source=(await json('/api/sources')).data.sources.find(s=>s.url===item.url);
 if(!source){const added=await json('/api/sources',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...item,adapter:'github_jobs',enabled:false})});assert.equal(added.response.status,201,JSON.stringify(added.data));source={...item,id:added.data.id};}
 const result=await json(`/api/sources/${source.id}`,{method:'POST'});
 const report={...result.data,url:item.url,elapsedMs:Date.now()-started};results.push(report);console.log(JSON.stringify(report));
 if(result.response.ok){assert.equal(report.adapter,'github_jobs');assert(report.jobs<=50,'A community source must not fetch more than fifty jobs with unverified publication dates');}
}
const after=(await json('/api/ai/status')).data;
assert.equal(after.usage.reduce((n,r)=>n+r.calls,0),before.usage.reduce((n,r)=>n+r.calls,0),'Source verification must not call a model');
fs.mkdirSync('outputs',{recursive:true});fs.writeFileSync('outputs/community-source-verification.json',JSON.stringify({generatedAt:new Date().toISOString(),sources:results,paidAiRequestsAdded:0},null,2));
console.log(JSON.stringify({tested:results.length,available:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,paidAiRequestsAdded:0}));
if(results.some(r=>!r.ok))process.exitCode=1;
