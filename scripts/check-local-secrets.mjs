// Never print or serialize credentials. Report only whether a leak was detected.
import {readFileSync,readdirSync} from 'node:fs';
import {parseEnv} from 'node:util';
import path from 'node:path';
const config=parseEnv(readFileSync('.env','utf8'));
const key=config.DEEPSEEK_API_KEY||config.deepseekapi;
if(!key)throw new Error('No configured DeepSeek key to audit.');
function files(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(directory,entry.name)):[path.join(directory,entry.name)]);}
const bundled=files('dist').some(file=>readFileSync(file).includes(Buffer.from(key)));
let exposed=false;
for(const route of ['/api/ai/status','/api/jobs','/api/sources','/api/sync/progress','/.env']){
 const response=await fetch('http://127.0.0.1:4173'+route);const body=await response.text();if(body.includes(key))exposed=true;
 if(route==='/.env'&&response.status!==404)throw new Error('Unexpected .env route status.');
}
console.log(JSON.stringify({bundledCredential:bundled,exposedCredential:exposed}));
if(bundled||exposed)process.exitCode=1;
