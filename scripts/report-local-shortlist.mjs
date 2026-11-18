// Offline replay of public job fields from a pre-filter backup; never calls a model.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {loadLocalTypeScript} from './load-local-typescript.mjs';
const {ruleRejection}=loadLocalTypeScript('lib/job-classifier.ts');
const {localShortlist}=loadLocalTypeScript('lib/local-shortlist.ts');
const {dayWindow,isInCrawlWindow}=loadLocalTypeScript('lib/crawl-window.ts');
let result;
for(const filename of fs.readdirSync('outputs').filter(n=>n.startsWith('before-ai-filter-')&&n.endsWith('.sqlite'))){
 const db=new DatabaseSync(path.join('outputs',filename),{readOnly:true});
 try {
  if(!db.prepare("SELECT name FROM sqlite_master WHERE name='jobs'").get())continue;
  const rows=db.prepare('SELECT company,title,location,description,posted_at,publication_verified FROM jobs').all();
  const count=items=>({jobs:items.length,previousRuleCandidates:items.filter(j=>!ruleRejection(j)).length,
    shortlisted:items.filter(j=>!ruleRejection(j)&&!localShortlist(j).reason).length});
  result={sample:count(rows),verifiedToday:count(rows.filter(j=>j.publication_verified===1&&isInCrawlWindow(j.posted_at))),day:dayWindow().date};break;
 }finally{db.close();}
}
if(!result)throw new Error('No pre-filter backup found.');
fs.writeFileSync('outputs/local-shortlist-replay.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
