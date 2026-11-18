import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {loadLocalTypeScript} from './load-local-typescript.mjs';
import {startBrowser} from './cdp-browser.mjs';
const {AI_POLICY}=loadLocalTypeScript('lib/classification-types.ts');
const base=process.env.JOB_RADAR_URL||'http://127.0.0.1:4173',marker='broad-screening-'+randomUUID(),now=new Date().toISOString();
const quote='We offer visa sponsorship for this position.';
const fixtures=[
 {category:'quant_development',title:'Quant Developer New Grad',country:'US',extra:''},
 {category:'data_science',title:'Data Scientist New Grad',country:'US',extra:quote,sponsored:true},
 {category:'solutions_architect',title:'Solutions Architect New Grad',country:'US',extra:'This position does not offer visa sponsorship.'},
 {category:'forward_deployed',title:'Forward Deployed Engineer New Grad',country:'US',extra:quote,sponsored:true},
 {category:'related_technical',title:'Technical Consultant New Grad',country:'CN',extra:quote},
 {category:'software_engineering',title:'Software Engineer New Grad',country:'US',extra:'Visa sponsorship may be considered.'},
];
const sql=value=>`'${String(value).replaceAll("'","''")}'`;
function execute(command){execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--command',command],{stdio:['ignore','pipe','pipe'],timeout:60000});}
async function api(path){
 for(let attempt=0;attempt<3;attempt++){
  let response;try{response=await fetch(base+path,{signal:AbortSignal.timeout(15000)});}catch(error){if(attempt===2)throw error;await new Promise(r=>setTimeout(r,250));continue;}
  assert.equal(response.status,200);return response.json();
 }
}
const progress=await api('/api/sync/progress');assert(!['running','cancelling'].includes(progress.run?.status),'Run with sync idle and the hourly scheduler stopped.');
const before=await api('/api/ai/status'),beforeTotal=(await api('/api/jobs')).pagination.total;
let browser;
try{
 let command=`INSERT INTO sources(name,url,adapter,enabled) VALUES(${sql(marker)},${sql('https://example.invalid/'+marker)},'jsonld',0);`;
 for(const [i,item]of fixtures.entries()){
  const location=item.country==='US'?'New York, United States':'Beijing, China',description=`${item.title}. New Grad role using Python for technical work. ${item.extra}`;
  const analysis={accepted:true,categories:[item.category],careerLevel:'new_grad',countries:[item.country],techStack:[{name:'Python',evidence:'using Python'}],roleEvidence:item.title,levelEvidence:'New Grad',locationEvidence:location,reason:'Synthetic screening fixture'};
  // No sponsorship field: existing approvals must be annotated from their own JD, without a paid re-review.
  command+=`INSERT INTO jobs(source_id,source_external_key,dedupe_key,canonical_url,company,title,location,description,posted_at,publication_verified,first_seen_at,last_seen_at,updated_at,ai_policy,ai_analysis) SELECT id,${sql(marker+i)},${sql(marker+i)},${sql('https://example.invalid/'+marker+'/'+i)},${sql(marker)},${sql(item.title)},${sql(location)},${sql(description)},${sql(now)},1,${sql(now)},${sql(now)},${sql(now)},${sql(AI_POLICY)},${sql(JSON.stringify(analysis))} FROM sources WHERE name=${sql(marker)};`;
 }
 execute(command);
 const listed=await api('/api/jobs?q='+marker);assert.equal(listed.jobs.length,fixtures.length);
 for(const item of fixtures){const job=listed.jobs.find(j=>j.title===item.title);assert(job);assert.equal(!!job.classification.usSponsorship?.available,!!item.sponsored,item.title);const filtered=await api('/api/jobs?q='+marker+'&category='+item.category);assert.equal(filtered.pagination.total,1);}
 browser=await startBrowser('broad-screening-browser');
 const {targetId}=await browser.call('Target.createTarget',{url:'about:blank'}),{sessionId}=await browser.call('Target.attachToTarget',{targetId,flatten:true});const call=(m,p={})=>browser.call(m,p,sessionId),errors=[];
 browser.listeners.add(m=>{if(m.sessionId===sessionId&&m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
 await call('Page.enable');await call('Runtime.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 async function evaluate(expression){const d=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(d.exceptionDetails)throw Error(d.exceptionDetails.exception?.description||d.exceptionDetails.text);return d.result.value;}
 async function until(expression,label){for(let i=0;i<120;i++){try{if(await evaluate(expression))return;}catch(e){if(!/context|Cannot find/i.test(e.message))throw e;}await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+label);}
 async function fill(selector,value){await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),p=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
 await call('Page.navigate',{url:base+'/'});await until(`!!document.querySelector('input[aria-label="搜索职位"]')&&!document.querySelector('main .animate-pulse')&&!!document.querySelector('main .job-card')`,'jobs ready');
 await fill('input[aria-label="搜索职位"]',marker);await until(`document.querySelectorAll('main .job-card').length===6&&[...document.querySelectorAll('main .job-card')].every(el=>el.textContent.includes(${JSON.stringify(marker)}))`,'synthetic jobs');
 assert.equal(await evaluate(`document.querySelectorAll('main .job-card [aria-label="美国签证赞助"]').length`),2);
 for(const item of fixtures)assert(await evaluate(`!!document.querySelector('select[aria-label="岗位分类"] option[value="${item.category}"]')`));
 await fill('select[aria-label="岗位分类"]','quant_development');await until(`document.querySelectorAll('main .job-card').length===1&&document.querySelector('main .job-card').textContent.includes('Quant Developer')`,'quant filter');
 await fill('select[aria-label="岗位分类"]','data_science');await until(`document.querySelectorAll('main .job-card').length===1&&document.querySelector('main .job-card').textContent.includes('Data Scientist')`,'data science filter');
 await evaluate(`document.querySelector('main .job-card > button').click()`);await until(`!!document.querySelector('[aria-label="美国签证赞助原文"]')`,'JD sponsorship evidence');
 assert((await evaluate(`document.querySelector('[aria-label="美国签证赞助原文"]').textContent`)).includes(quote));
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+2'),'Mobile overflow');
 await evaluate(`document.querySelector('[aria-label="美国签证赞助原文"]').scrollIntoView({block:'center'})`);const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync('outputs/broad-screening-mobile.png',Buffer.from(shot.data,'base64'));
 assert.equal(errors.length,0,JSON.stringify(errors));console.log(JSON.stringify({newCategories:true,categoryFiltering:true,sponsoredUsBadges:2,noFalseBadges:true,verbatimJdEvidence:true,existingApprovalsRemainVisible:true,mobile:true,javascriptErrors:0}));
}finally{
 if(browser)await browser.close();
 execute(`DELETE FROM jobs WHERE source_id IN(SELECT id FROM sources WHERE name=${sql(marker)});DELETE FROM sources WHERE name=${sql(marker)};`);
}
const after=await api('/api/ai/status');assert.equal(after.usage.reduce((n,r)=>n+r.calls,0),before.usage.reduce((n,r)=>n+r.calls,0));assert.equal((await api('/api/jobs')).pagination.total,beforeTotal);
console.log(JSON.stringify({paidAiRequestsAdded:0,testDataRemoved:true}));
