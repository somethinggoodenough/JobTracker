import fs from 'node:fs';
import {loadLocalTypeScript} from './load-local-typescript.mjs';
const {crawlSource}=loadLocalTypeScript('lib/crawler.ts');
const {withCrawlWindow,dayWindow}=loadLocalTypeScript('lib/crawl-window.ts');
const tasks=[
 {name:'Greenhouse example: Imbue',url:'https://job-boards.greenhouse.io/imbue',adapter:'greenhouse'},
 {name:'Ashby example: Perplexity',url:'https://jobs.ashbyhq.com/Perplexity',adapter:'ashby'},
 {name:'Lever example: Palantir',url:'https://jobs.lever.co/palantir',adapter:'lever'},
 {name:'Workday example: NVIDIA',url:'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',adapter:'workday',runtime:true},
 {name:'Workable example: Hugging Face',url:'https://apply.workable.com/huggingface/',adapter:'workable',date:'2026-09-21T00:00:00Z'},
];
let i=0;const results=[];
async function runtimeCheck(source){
 const base=process.env.JOB_RADAR_URL||'http://127.0.0.1:4173',url=new URL(source.url);url.searchParams.set('adapter_check',String(Date.now()));let id;
 try{const add=await fetch(base+'/api/sources',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Workday adapter verification fixture',url:url.href,adapter:'workday',enabled:false})}),added=await add.json();if(!add.ok)throw new Error(added.error);id=added.id;
 const response=await fetch(base+'/api/sources/'+id,{method:'POST',signal:AbortSignal.timeout(180000)}),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error);return result;
 }finally{if(id){const removed=await fetch(base+'/api/sources/'+id,{method:'DELETE'});if(!removed.ok)throw new Error('Could not remove the temporary test source.');}}
}
await Promise.all(Array.from({length:3},async()=>{while(i<tasks.length){const s=tasks[i++],started=Date.now();try{
 if(s.runtime){const result=await runtimeCheck(s);results.push({...s,ok:true,jobs:result.jobs,fullJd:result.jobs>0?true:null,warning:result.warning,ms:Date.now()-started});}
 else{const jobs=await withCrawlWindow(dayWindow(s.date?new Date(s.date):new Date()),()=>crawlSource({...s,id:99999}));results.push({...s,ok:true,jobs:jobs.length,fullJd:jobs.length?jobs.every(j=>j.description.length>50):null,warning:jobs.warnings,ms:Date.now()-started});}
 }catch(e){results.push({...s,ok:false,error:e.message,ms:Date.now()-started});}console.log(JSON.stringify(results.at(-1)));}}));
fs.writeFileSync('outputs/provider-adapter-verification.json',JSON.stringify(results,null,2));
