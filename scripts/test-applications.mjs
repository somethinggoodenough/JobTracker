// A local integration test. Only uniquely named synthetic rows are created/deleted.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {loadLocalTypeScript} from './load-local-typescript.mjs';
const {AI_POLICY}=loadLocalTypeScript('lib/classification-types.ts');
const analysis={accepted:true,categories:['backend_distributed'],careerLevel:'new_grad',countries:['US'],techStack:[],roleEvidence:'Snapshot JD',levelEvidence:'New Grad',locationEvidence:'New York',reason:'Synthetic application fixture'};
const base=process.argv[2]||'http://127.0.0.1:4173';
const key=`application-test-${randomUUID()}`,url=`https://example.invalid/${key}`,now=new Date().toISOString();
const sql=value=>`'${String(value).replaceAll("'","''")}'`;
function execute(command){execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--command',command],{cwd:process.cwd(),stdio:['ignore','pipe','pipe'],timeout:60000});}
async function api(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});return {status:r.status,...await r.json()};}
const expectOK=result=>{assert(result.status===200||result.status===201,JSON.stringify(result));return result;};
let applicationId;
const progress=await api('/api/sync/progress');
if(['running','cancelling'].includes(progress.run?.status))throw new Error('Wait for the active sync to finish before running database fixture tests.');
try{
 execute(`INSERT INTO sources(name,url,adapter,enabled) VALUES(${sql(key)},${sql(url)},'jsonld',0);
 INSERT INTO jobs(source_id,source_external_key,dedupe_key,canonical_url,apply_url,company,title,location,description,posted_at,publication_verified,first_seen_at,last_seen_at,updated_at,ai_policy,ai_analysis)
 SELECT id,${sql(key)},${sql(key)},${sql(url)},${sql(url)},${sql(key)},'Application tracker test','New York','Snapshot JD for retention test',${sql(now)},1,${sql(now)},${sql(now)},${sql(now)},${sql(AI_POLICY)},${sql(JSON.stringify(analysis))} FROM sources WHERE url=${sql(url)};`);
 const listing=expectOK(await api('/api/jobs?q='+encodeURIComponent(key)));const job=listing.jobs[0];assert(job);
 const results=await Promise.all(Array.from({length:4},()=>api('/api/applications','POST',{jobId:job.id})));
 for(const result of results)expectOK(result);
 applicationId=results[0].application.id;
 assert(results.every(r=>r.application.id===applicationId),'Concurrent additions must return the same application');
 assert.equal(results.filter(r=>r.created).length,1);assert(results.every(r=>r.history.length===1));
 assert.equal(expectOK(await api('/api/jobs?q='+key)).jobs[0].application_id,applicationId);
 let detail=expectOK(await api(`/api/applications/${applicationId}`));
 const data={resume:'resume-v3.pdf / English backend',email:'tracker-test@example.com',applied_at:'2026-11-17T09:30:00-05:00',status:'applied',status_at:'2026-11-17T09:35:00-05:00',version:detail.application.version};
 detail=expectOK(await api(`/api/applications/${applicationId}`,'PATCH',data));assert.equal(detail.history.length,2);
 assert.equal(detail.application.applied_at,'2026-11-17T14:30:00.000Z');assert.equal(detail.application.email,data.email);assert.equal(detail.application.resume,data.resume);
 assert.equal((await api(`/api/applications/${applicationId}`,'PATCH',data)).status,409,'Stale edits must not overwrite');
 detail=expectOK(await api(`/api/applications/${applicationId}`,'PATCH',{...data,resume:'resume-v4.pdf',version:detail.application.version}));assert.equal(detail.history.length,2,'Editing resume must not add a status event');
 const corrected='2026-11-17T15:00:00.000Z';
 detail=expectOK(await api(`/api/applications/${applicationId}`,'PATCH',{...data,status_at:corrected,version:detail.application.version}));assert.equal(detail.history.length,2);assert.equal(detail.history[1].reached_at,corrected);
 detail=expectOK(await api(`/api/applications/${applicationId}`,'PATCH',{...data,status:'interview',status_at:'2026-11-18T15:00:00Z',version:detail.application.version}));assert.equal(detail.history.length,3);
 const filtered=expectOK(await api(`/api/applications?q=${key}&status=interview&page=-1`));assert.equal(filtered.pagination.page,1);assert.equal(filtered.pagination.total,1);
 assert.equal(expectOK(await api(`/api/applications?q=${key}&status=offer`)).pagination.total,0);
 assert.equal((await api(`/api/applications/${applicationId}`,'PATCH',{...data,email:'invalid',version:detail.application.version})).status,400);
 const simultaneous=await Promise.all(['offer','rejected'].map(status=>api(`/api/applications/${applicationId}`,'PATCH',{...data,status,version:detail.application.version})));
 assert.equal(simultaneous.filter(r=>r.status===200).length,1);assert.equal(simultaneous.filter(r=>r.status===409).length,1);
 detail=expectOK(await api(`/api/applications/${applicationId}`));assert.equal(detail.history.length,4);
 assert.equal(detail.history.at(-1).status,detail.application.status);
 // Exercise the exact retention deletion against this synthetic source only.
 execute(`UPDATE jobs SET posted_at='2000-01-01T00:00:00.000Z' WHERE canonical_url=${sql(url)};
 DELETE FROM jobs WHERE canonical_url=${sql(url)} AND posted_at<=${sql(new Date(Date.now()-7*86400000).toISOString())};
 DELETE FROM sources WHERE url=${sql(url)};`);
 detail=expectOK(await api(`/api/applications/${applicationId}`));assert.equal(detail.application.company,key);assert.equal(detail.application.description,'Snapshot JD for retention test');assert.equal(detail.history.length,4);
 assert.deepEqual(detail.application.classification,analysis,'The application retains its AI classification snapshot');
 assert.equal((await api('/api/applications','POST',{jobId:job.id})).status,404);
 for(const path of ['/','/applications','/today','/sources','/runs']){const response=await fetch(base+path);assert.equal(response.status,200);const html=await response.text();assert(html.includes('href="/applications"'));if(path==='/applications')assert(html.includes('申请职位状态'));}
 expectOK(await api(`/api/applications/${applicationId}`,'DELETE'));assert.equal((await api(`/api/applications/${applicationId}`)).status,404);
 console.log(JSON.stringify({pass:true,concurrentDedup:true,statusHistory:true,optimisticEdits:true,retentionSnapshot:true,allRoutes:true}));
}finally{
 execute(`DELETE FROM applications WHERE canonical_url=${sql(url)};DELETE FROM jobs WHERE canonical_url=${sql(url)};DELETE FROM sources WHERE url=${sql(url)};`);
}
