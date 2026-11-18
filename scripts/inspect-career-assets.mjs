import fs from 'node:fs';
const mode=process.argv[2];
if(mode==='apple'){
 const h=fs.readFileSync(`outputs/adapter-probes/${process.argv[3]||'apple-0'}.txt`,'utf8');
 const m=h.match(/window\.__staticRouterHydrationData\s*=\s*JSON\.parse\(("(?:\\.|[^"\\])*")\)/);
 const d=JSON.parse(JSON.parse(m[1]));
 fs.writeFileSync(`outputs/adapter-probes/${process.argv[3]||'apple'}-data.txt`,JSON.stringify(d,null,2));
 console.log(Object.keys(d.loaderData));
 for(const [k,v] of Object.entries(d.loaderData))if(k!=='root')console.log(k,JSON.stringify(v,(k,v)=>typeof v==='string'?v.slice(0,100):v,2).slice(0,6500));
}else if(mode==='feishu'){
 const h=fs.readFileSync('outputs/adapter-probes/feishu-1.txt','utf8');
 for(const m of h.matchAll(/<script[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/script>/g)){
  if(m[1]==='js-websiteInfo'){const d=JSON.parse(m[2]);console.log('website',Object.keys(d),JSON.stringify(d.website_info).slice(0,3000));}
 }
 const scripts=[...h.matchAll(/src="([^"]+static\/js\/[^\"]+)/g)].map(x=>x[1]);
 for(const [i,url] of scripts.entries()){
  const r=await fetch(url,{signal:AbortSignal.timeout(20000)});const body=await r.text();
  fs.writeFileSync(`outputs/adapter-probes/feishu-bundle-${i}.txt`,body);
  console.log(i,body.length,[...new Set([...body.matchAll(/.{0,80}(?:\/api\/v[0-9]|job\/posts|job_post|search\/job|portal\/job).{0,170}/g)].map(m=>m[0]))].slice(0,20));
 }
}else if(mode==='tokens'){
 const a=JSON.parse(fs.readFileSync('outputs/company-adapter-audit.json'));
 for(const name of ['Fal.ai','CoreWeave','Ayar Labs','Hippocratic AI','Modular','SambaNova','VAST Data','Contextual AI','Groq']){
  const s=a.sources.find(s=>s.name===name);const h=fs.readFileSync(`outputs/adapter-probes/${s.file}.txt`,'utf8');
  console.log(name,[...h.matchAll(/.{0,150}(?:ashby|greenhouse|comeet|workable|api\.|job_board|boardToken|board_token|jobBoard).{0,250}/gi)].slice(0,15).map(m=>m[0]).join('\n'));
 }
}
