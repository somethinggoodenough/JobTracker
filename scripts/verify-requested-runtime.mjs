import fs from 'node:fs';
import assert from 'node:assert/strict';
const base=process.env.JOB_RADAR_URL||'http://127.0.0.1:4173';
const requested=JSON.parse(fs.readFileSync('data/requested-adapters.json','utf8'));
const match=name=>requested.some(n=>name.toLowerCase().includes(n.toLowerCase()));
const get=async path=>{const r=await fetch(base+path);if(!r.ok)throw new Error(`${path}: HTTP ${r.status}`);return r.json();};
const before=await get('/api/jobs'),aiBefore=await get('/api/ai/status');
const progress=await get('/api/sync/progress');if(['running','cancelling'].includes(progress.run?.status))throw new Error('Wait for the active sync before source verification.');
let all=(await get('/api/sources')).sources;
if(!all.some(s=>s.name==='TikTok')){const r=await fetch(base+'/api/sources',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'TikTok',url:'https://lifeattiktok.com/search',adapter:'tiktok',enabled:false})});if(!r.ok)throw new Error(await r.text());all=(await get('/api/sources')).sources;}
const selected=all.filter(s=>match(s.name)&&!requested.slice(0,5).includes(s.name)&&(!process.argv[2]||process.argv.slice(2).includes(s.name)));
fs.mkdirSync('outputs',{recursive:true});const file='outputs/requested-adapter-runtime.json';let previous=[];
try{previous=JSON.parse(fs.readFileSync(file,'utf8')).sources;}catch{}
const results=[];let i=0;
const save=()=>fs.writeFileSync(file,JSON.stringify({generatedAt:new Date().toISOString(),sources:[...previous.filter(s=>!results.some(r=>r.name===s.name)),...results]},null,2));
await Promise.all(Array.from({length:3},async()=>{while(i<selected.length){const source=selected[i++],start=Date.now();let result;
try{const response=await fetch(`${base}/api/sources/${source.id}`,{method:'POST',signal:AbortSignal.timeout(15*60_000)});const body=await response.json();result={...body,url:source.url,ms:Date.now()-start};}
catch(e){result={name:source.name,url:source.url,ok:false,error:e.message,ms:Date.now()-start};}
results.push(result);save();console.log(JSON.stringify(result));}}));
const after=await get('/api/jobs'),aiAfter=await get('/api/ai/status');
assert.equal(after.pagination.total,before.pagination.total,'Verification must not delete or admit jobs.');
for(const key of ['dailyBudget','daily_budget','budget'])if(aiBefore[key])assert.deepEqual(aiAfter[key],aiBefore[key],'Verification must not consume model quota.');
console.log(JSON.stringify({tested:results.length,ok:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).map(r=>r.name),jobsBefore:before.pagination.total,jobsAfter:after.pagination.total,modelCalls:0}));
