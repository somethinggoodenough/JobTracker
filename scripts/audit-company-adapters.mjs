import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
const previous=JSON.parse(readFileSync('outputs/source-verification.json','utf8'));
const registry=JSON.parse(readFileSync('data/source-registry.json','utf8'));
const official={
 'Groq':'https://groq.com/careers/', 'Hebbia':'https://www.hebbia.com/careers',
 'Hippocratic AI':'https://www.hippocraticai.com/careers', 'Imbue':'https://imbue.com/careers/',
 'Lightmatter':'https://lightmatter.co/careers/', 'Luma AI':'https://lumalabs.ai/careers',
 'Modular':'https://www.modular.com/company/careers', 'SambaNova':'https://sambanova.ai/careers',
 'VAST Data':'https://www.vastdata.com/careers', 'Essential AI':'https://www.essential.ai/careers',
 'Fal.ai':'https://fal.ai/careers', 'Dify（LangGenius）':'https://dify.ai/careers',
 'Nexthop AI':'https://www.nexthop.ai/careers', 'Voltage Park':'https://www.voltagepark.com/careers',
 'CoreWeave':'https://www.coreweave.com/careers', 'Cornelis Networks':'https://www.cornelisnetworks.com/careers/',
};
const candidates=previous.sources.filter(s=>!s.ok && s.adapter!=='provider');
mkdirSync('outputs/adapter-probes',{recursive:true});
let cursor=0;const results=[];
await Promise.all(Array.from({length:4},async()=>{
 while(cursor<candidates.length){const source=candidates[cursor++]; const url=official[source.name]||source.url;
 try{
  const r=await fetch(url,{signal:AbortSignal.timeout(22000),headers:{'user-agent':'JobRadar/1.0'}});
  const html=await r.text();const file=`audit-${registry.findIndex(s=>s.name===source.name)}`;
  writeFileSync(`outputs/adapter-probes/${file}.txt`,html);
  const decoded=html.replaceAll('\\/','/').replaceAll('\\u002F','/').replaceAll('&amp;','&');
  const ats=[...new Set([...decoded.matchAll(/https?:\/\/(?:[a-z0-9_-]+\.)*(?:greenhouse\.io|ashbyhq\.com|lever\.co|workable\.com|myworkdayjobs\.com|smartrecruiters\.com|mokahr\.com|feishu\.cn|larkoffice\.com|zhipin\.com)[^\s"'<>\\]*/gi)].map(m=>m[0]))].slice(0,12);
  const systems=['eightfold','avature','successfactors','moka','beisen','feishu','dayee','yonyou','phenom','oraclecloud'].filter(s=>decoded.toLowerCase().includes(s));
  results.push({name:source.name,original:source.url,url:r.url,status:r.status,ats,systems,file});
 }catch(e){results.push({name:source.name,original:source.url,url,error:e.message});}
 if(results.length%10===0)console.log('Audited',results.length,'/',candidates.length);
 }
}));
results.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
writeFileSync('outputs/company-adapter-audit.json',JSON.stringify({generatedAt:new Date().toISOString(),sources:results},null,2));
for(const r of results.filter(r=>r.ats?.length||r.systems?.length))console.log(JSON.stringify(r));
console.log('TOTAL',results.length);
