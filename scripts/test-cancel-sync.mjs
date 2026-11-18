import assert from 'node:assert/strict';
const base=process.argv[2]||'http://127.0.0.1:4173';
async function json(path,init){const r=await fetch(base+path,{...init,signal:AbortSignal.timeout(30000)});const d=await r.json();return{response:r,data:d};}
const before=(await json('/api/jobs')).data;
const previous=(await json('/api/sync/progress')).data.run;
if(previous&&['running','cancelling'].includes(previous.status)&&Date.now()-Date.parse(previous.started_at)<30*60_000)throw new Error('已有活动同步，请先在网站中取消后再运行此测试');
let lastId=previous?.id||0;
for(let attempt=0;attempt<2;attempt++){
 const request=fetch(base+'/api/sync',{method:'POST',signal:AbortSignal.timeout(60000)}).then(async response=>({response,data:await response.json()}));
 let run;
 for(let i=0;i<100;i++){
  const progress=(await json('/api/sync/progress')).data;
  if(progress.run?.id>lastId&&progress.run.status==='running'){run=progress.run;break;}
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 assert(run,'新同步应成功启动（验证取消后同步锁已释放）');
 if(attempt===0)await new Promise(resolve=>setTimeout(resolve,2000));
 const started=Date.now();
 const cancel=await json('/api/sync/cancel',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({runId:run.id})});
 assert.equal(cancel.response.status,200,JSON.stringify(cancel.data));assert(['cancelling','cancelled'].includes(cancel.data.status));
 const summary=await request;assert.equal(summary.data.status,'cancelled');assert.equal(summary.data.runId,run.id);
 const progress=(await json('/api/sync/progress')).data;
 assert.equal(progress.run.status,'cancelled');
 assert(progress.sources.every(s=>!['queued','fetching','saving','classifying'].includes(s.stage)));
 assert(progress.sources.some(s=>s.stage==='cancelled'));
 const repeated=await json('/api/sync/cancel',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({runId:run.id})});
 assert.equal(repeated.data.status,'cancelled');
 const snapshot=JSON.stringify(progress.sources);
 await new Promise(resolve=>setTimeout(resolve,800));
 assert.equal(JSON.stringify((await json('/api/sync/progress')).data.sources),snapshot,'取消完成后进度不应继续变化');
 lastId=run.id;
 console.log(JSON.stringify({runId:run.id,status:summary.data.status,cancelMs:Date.now()-started,added:summary.data.jobsAdded,updated:summary.data.jobsUpdated}));
}
const after=(await json('/api/jobs')).data;
const ids=new Set(after.jobs.map(j=>j.id));
assert(before.jobs.slice(0,10).every(j=>ids.has(j.id)),'取消应保留现有职位');
assert.equal((await json('/api/sync/cancel',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).response.status,400);
assert.equal((await json('/api/sync/cancel',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({runId:999999999})})).response.status,404);
console.log('PASS: abort in-flight sync, preserve jobs, repeated cancel, restart, invalid run IDs, no writes after cancellation');
