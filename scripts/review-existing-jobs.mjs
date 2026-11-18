import {mkdirSync,writeFileSync} from 'node:fs';
const base=process.argv[2]||'http://127.0.0.1:4173';
console.log('Reviewing stored jobs against US/CN, early-career and engineering-category requirements.');
const response=await fetch(base+'/api/sync?reviewOnly=1',{method:'POST',signal:AbortSignal.timeout(55*60_000)});
const result=await response.json();
mkdirSync('outputs',{recursive:true});writeFileSync('outputs/ai-review-result.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));if(!response.ok||result.error||result.status==='failed')process.exitCode=1;
