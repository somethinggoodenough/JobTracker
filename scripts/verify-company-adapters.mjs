import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createRequire } from 'node:module';
const nativeRequire = createRequire(import.meta.url);
const cache = new Map();
// Compile only local TypeScript modules; this never evaluates downloaded pages.
function localRequire(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  if (filename.endsWith('.json')) return JSON.parse(fs.readFileSync(filename, 'utf8'));
  const module = { exports: {} }; cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,resolveJsonModule:true}}).outputText;
  const require = name => {
    if (!name.startsWith('.') && !name.startsWith('@/')) return nativeRequire(name);
    let resolved = name.startsWith('@/') ? path.resolve(name.slice(2)) : path.resolve(path.dirname(filename), name);
    if (!fs.existsSync(resolved)) resolved += '.ts';
    return localRequire(resolved);
  };
  new Function('require','exports','module',code)(require,module.exports,module);
  return module.exports;
}
const {crawlSource}=localRequire(path.resolve('lib/crawler.ts'));
const profiles=JSON.parse(fs.readFileSync('data/company-adapters.json','utf8'));
const names=process.argv.slice(2);
const candidates=profiles.filter(p=>!names.length||names.includes(p.name));
const results=[]; let cursor=0;
let previous=[];
try{previous=JSON.parse(fs.readFileSync('outputs/company-adapter-verification.json','utf8')).sources||[];}catch{}
const persist=()=>fs.writeFileSync('outputs/company-adapter-verification.json',JSON.stringify({generatedAt:new Date().toISOString(),sources:[...previous.filter(p=>!results.some(r=>r.name===p.name)),...results]},null,2));
fs.mkdirSync('outputs',{recursive:true});
await Promise.all(Array.from({length:3},async()=>{
  while(cursor<candidates.length){const p=candidates[cursor++];const start=Date.now();
    try{const jobs=await crawlSource({...p,id:1});
      const invalid=jobs.filter(j=>!j.title||!j.canonicalUrl||!j.externalId||!j.description);
      const result={name:p.name,adapter:p.adapter,url:p.url,ok:(jobs.length>0||p.allowEmpty===true)&&invalid.length===0,empty:jobs.length===0&&p.allowEmpty===true,partial:!!jobs.warnings?.length,warnings:jobs.warnings||[],jobs:jobs.length,invalid:invalid.length,elapsedMs:Date.now()-start,
        recentJobs:jobs.filter(j=>!j.postedAt||Date.parse(j.postedAt)>Date.now()-7*86400000).length,
        sample:jobs.slice(0,2).map(j=>({title:j.title,company:j.company,url:j.canonicalUrl,location:j.location,postedAt:j.postedAt,jdLength:j.description.length})),error:jobs.length===0&&!p.allowEmpty?'接口返回零职位，尚未确认是否为正确招聘板':invalid.length?'部分职位缺少必要字段':null};
      results.push(result);persist();console.log(JSON.stringify(result));
    }catch(e){const result={name:p.name,adapter:p.adapter,url:p.url,ok:false,jobs:0,error:e.message,elapsedMs:Date.now()-start};results.push(result);persist();console.log(JSON.stringify(result));}
  }
}));
persist();
