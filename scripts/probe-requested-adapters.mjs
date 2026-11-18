import fs from 'node:fs';
const names=JSON.parse(fs.readFileSync('data/requested-adapters.json','utf8'));
const registry=JSON.parse(fs.readFileSync('data/source-registry.json','utf8'));
const matches=name=>names.some(n=>name.toLowerCase().includes(n.toLowerCase()));
const selected=registry.filter(s=>matches(s.name));
if(!selected.some(s=>/tiktok/i.test(s.name)))selected.push({name:'TikTok',url:'https://lifeattiktok.com/search',kind:'company'});
const live=(await(await fetch('http://127.0.0.1:4173/api/sources')).json()).sources;
let oldAudit=[];try{oldAudit=JSON.parse(fs.readFileSync('outputs/company-adapter-audit.json','utf8')).sources;}catch{}
fs.mkdirSync('outputs/requested-adapter-probes',{recursive:true});
const tasks=selected.filter(s=>s.kind!=='provider'),results=[];let cursor=0;
await Promise.all(Array.from({length:4},async()=>{while(cursor<tasks.length){const i=cursor++,s=tasks[i],start=Date.now();
 try{
  const r=await fetch(s.url,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'Mozilla/5.0 (compatible; JobRadar/1.0)','Accept':'text/html,application/json'}});
  const html=await r.text(),decoded=html.replaceAll('\\/','/').replaceAll('\\u002F','/').replaceAll('&amp;','&');
  fs.writeFileSync(`outputs/requested-adapter-probes/${i}.html`,html);
  const urls=[...new Set([...decoded.matchAll(/https?:\/\/[^\s"'<>\\]+/g)].map(m=>m[0]))];
  const ats=urls.filter(u=>/greenhouse|ashbyhq|lever\.co|myworkdayjobs|workable|avature|mokahr|zhiye\.com|feishu\.cn|jobs\.gem\.com|oraclecloud|join\.dify/i.test(u)).slice(0,8);
  const scripts=[...html.matchAll(/<script[^>]*src=["']([^"']+)/g)].map(m=>new URL(m[1],r.url).toString()).slice(-10);
  const previous=live.find(x=>x.name===s.name);
  const result={i,name:s.name,url:s.url,status:r.status,finalUrl:r.url,bytes:html.length,title:html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.slice(0,150),ats,scripts,
   previous:previous&&{id:previous.id,enabled:previous.enabled,adapter:previous.adapter,error:previous.last_error},oldAudit:oldAudit.find(x=>x.name===s.name)?.ats,elapsedMs:Date.now()-start};
  results.push(result);console.log(JSON.stringify({...result,scripts:undefined,ats:result.ats.slice(0,4)}));
 }catch(e){const result={i,name:s.name,url:s.url,error:e.message,elapsedMs:Date.now()-start};results.push(result);console.log(JSON.stringify(result));}
 fs.writeFileSync('outputs/requested-adapter-audit.json',JSON.stringify({generatedAt:new Date().toISOString(),sources:results},null,2));
}}));
console.log(JSON.stringify({tested:results.length,reachable:results.filter(r=>r.status===200).length}));
