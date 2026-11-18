import fs from 'node:fs';
const audit=JSON.parse(fs.readFileSync('outputs/requested-adapter-audit.json','utf8')).sources;
const urls=new Set();
for(const i of process.argv.slice(2).map(Number)){
 let base=audit.find(s=>s.i===i)?.finalUrl||'https://app.mokahr.com';const filename=`outputs/career-network/${i}.html`;
 if(fs.existsSync(filename)){const html=fs.readFileSync(filename,'utf8');for(const m of html.matchAll(/(?:src|href)=["']([^"']+\.js[^"']*)/g))try{urls.add(new URL(m[1],base).toString());}catch{}}
 else for(const url of audit.find(s=>s.i===i)?.scripts||[])urls.add(url);
}
fs.mkdirSync('outputs/career-assets',{recursive:true});const list=[...urls].filter(u=>!/(?:analytics|sentry|collect|onetrack|bstatics.*analysis|polyfill|gtm|tagmanager)/i.test(u));let cursor=0;
await Promise.all(Array.from({length:4},async()=>{while(cursor<list.length){const i=cursor++,url=list[i];try{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});const text=await r.text();fs.writeFileSync(`outputs/career-assets/${i}.js`,text);const snippets=[...text.matchAll(/.{0,90}(?:necromancer|searchJobPage|queryPosition|jobList|job\/search|position\/search|jobAdId|\/api\/outer|jobdetail|queryJob|portalpub\/getJob|\.jobs\.feishu\.cn).{0,220}/gi)].slice(0,16).map(m=>m[0]);if(snippets.length)console.log(JSON.stringify({i,url,snippets}));}catch{}}}));
fs.writeFileSync('outputs/career-assets/urls.json',JSON.stringify(list,null,2));
