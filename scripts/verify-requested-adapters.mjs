import fs from 'node:fs';
import {loadLocalTypeScript} from './load-local-typescript.mjs';
const {crawlSource}=loadLocalTypeScript('lib/crawler.ts');
const profiles=JSON.parse(fs.readFileSync('data/company-adapters.json','utf8'));
const requested=JSON.parse(fs.readFileSync('outputs/requested-adapter-audit.json','utf8')).sources;
const selected=requested.filter(s=>profiles.some(p=>p.name===s.name)&&(!process.argv[2]||process.argv.slice(2).includes(String(s.i))));
let cursor=0;const results=[];
await Promise.all(Array.from({length:3},async()=>{while(cursor<selected.length){const s=selected[cursor++],p=profiles.find(p=>p.name===s.name),start=Date.now();try{const jobs=await crawlSource({...s,id:s.id||s.i+10000,adapter:p.adapter,url:p.url});const result={i:s.i,name:s.name,adapter:p.adapter,url:p.url,ok:true,jobs:jobs.length,ms:Date.now()-start,missingJd:jobs.filter(j=>j.description.length<100).length,warning:jobs.warnings,sample:jobs.slice(0,2).map(({title,location,description,canonicalUrl,postedAt})=>({title,location,jdLength:description.length,canonicalUrl,postedAt}))};results.push(result);console.log(JSON.stringify(result));}catch(e){const result={i:s.i,name:s.name,adapter:p.adapter,url:p.url,ok:false,ms:Date.now()-start,error:e.message,cause:e.cause?.message};results.push(result);console.log(JSON.stringify(result));}}}));
fs.mkdirSync('outputs',{recursive:true});fs.writeFileSync(`outputs/adapter-verification${process.argv[2]?'-selected':''}.json`,JSON.stringify(results,null,2));
