import fs from 'node:fs';
const base=process.argv[2]||'http://127.0.0.1:4173';
const profiles=JSON.parse(fs.readFileSync('data/company-adapters.json','utf8'));
const names=process.argv.slice(3);
const all=await(await fetch(`${base}/api/sources`)).json();
const candidates=all.sources.filter(s=>profiles.some(p=>p.name===s.name)&&(!names.length||names.includes(s.name)));
const results=[];let cursor=0;
let previous=[];
try{previous=JSON.parse(fs.readFileSync('outputs/company-adapter-runtime.json','utf8')).sources;}catch{}
fs.mkdirSync('outputs',{recursive:true});
await Promise.all(Array.from({length:3},async()=>{
 while(cursor<candidates.length){const s=candidates[cursor++];const started=Date.now();
  try{const r=await fetch(`${base}/api/sources/${s.id}`,{method:'POST',signal:AbortSignal.timeout(20*60_000)});const data=await r.json();results.push({...data,url:s.url,elapsedMs:Date.now()-started});console.log(JSON.stringify(results.at(-1)));}
  catch(e){results.push({name:s.name,url:s.url,ok:false,error:e.message,elapsedMs:Date.now()-started});console.log(JSON.stringify(results.at(-1)));}
  fs.writeFileSync('outputs/company-adapter-runtime.json',JSON.stringify({generatedAt:new Date().toISOString(),sources:[...previous.filter(s=>!results.some(r=>r.name===s.name)),...results]},null,2));
 }
}));
console.log('SUMMARY',JSON.stringify({tested:results.length,full:results.filter(s=>s.ok&&!s.partial).length,partial:results.filter(s=>s.ok&&s.partial).length,failed:results.filter(s=>!s.ok).length}));
