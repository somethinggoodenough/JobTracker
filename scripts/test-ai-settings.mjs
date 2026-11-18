import assert from 'node:assert/strict';
import {startBrowser} from './cdp-browser.mjs';
const base=process.env.JOB_RADAR_URL||'http://127.0.0.1:4173';
async function json(path,init){const r=await fetch(base+path,{...init,signal:AbortSignal.timeout(60000)});return{response:r,data:await r.json()};}
const patch=dailyLimit=>json('/api/ai/settings',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({dailyLimit})});
const original=(await json('/api/ai/settings')).data, before=(await json('/api/ai/status')).data;
const progress=(await json('/api/sync/progress')).data;
assert(!['running','cancelling'].includes(progress.run?.status),'Wait for the current sync before changing settings in this test.');
let browser;
try{
 for(const dailyLimit of [-1,2.5,'250',true])assert.equal((await patch(dailyLimit)).response.status,400);
 for(const dailyLimit of [0,250,null,original.dailyLimit]){
  const result=await patch(dailyLimit);assert.equal(result.response.status,200,JSON.stringify(result.data));
  assert.equal(result.data.dailyBudget.limit,dailyLimit);assert.equal(result.data.dailyBudget.used,before.dailyBudget.used);
  assert.equal(result.data.dailyBudget.remaining,dailyLimit===null?null:Math.max(0,dailyLimit-before.dailyBudget.used));
  assert.equal((await json('/api/ai/settings')).data.dailyLimit,dailyLimit);
 }
 // Exercise queue accounting with AI explicitly paused: only local rules/caches may run.
 await patch(0);
 const review=await json('/api/sync?reviewOnly=1',{method:'POST'});assert.equal(review.response.status,200);assert(!review.data.error,review.data.error);
 const screened=(await json('/api/ai/status')).data;
 assert.equal(screened.latestScreening.id,review.data.runId);assert.equal(screened.latestScreening.ai_requests,0);
 assert.equal(screened.dailyBudget.used,before.dailyBudget.used);
 await patch(original.dailyLimit);
 browser=await startBrowser('ai-settings-browser');
 const {targetId}=await browser.call('Target.createTarget',{url:'about:blank'});
 const {sessionId}=await browser.call('Target.attachToTarget',{targetId,flatten:true});
 const call=(method,params={})=>browser.call(method,params,sessionId);
 const errors=[];browser.listeners.add(m=>{if(m.sessionId===sessionId&&m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);});
 await call('Page.enable');await call('Runtime.enable');
 async function evaluate(expression){const d=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(d.exceptionDetails)throw new Error(d.exceptionDetails.text);return d.result.value;}
 async function until(expression,label){for(let i=0;i<120;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out: '+label);}
 async function fill(value){await evaluate(`(()=>{const input=document.querySelector('#daily-ai-limit');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
 const submit=()=>evaluate(`document.querySelector('form[aria-label="每日 AI 筛选额度设置"]').requestSubmit()`);
 await call('Page.navigate',{url:base+'/'});await until(`!!document.querySelector('#daily-ai-limit')`,'settings form');
 if(await evaluate(`document.querySelector('form[aria-label="每日 AI 筛选额度设置"] input[type=checkbox]').checked`))await evaluate(`document.querySelector('form[aria-label="每日 AI 筛选额度设置"] input[type=checkbox]').click()`);
 await fill(250);await submit();await until(`document.querySelector('section[aria-label="AI 筛选状态"]').textContent.includes('每日上限 250 次')`,'save chosen quota');
 await call('Page.reload');await until(`document.querySelector('#daily-ai-limit')?.value==='250'`,'quota survives reload');
 await evaluate(`document.querySelector('form[aria-label="每日 AI 筛选额度设置"] input[type=checkbox]').click()`);await submit();
 await until(`document.querySelector('section[aria-label="AI 筛选状态"]').textContent.includes('每日上限 不限')`,'unlimited mode');
 assert(await evaluate(`document.querySelector('#daily-ai-limit').disabled`));
 await evaluate(`document.querySelector('form[aria-label="每日 AI 筛选额度设置"] input[type=checkbox]').click()`);await fill(0);await submit();
 await until(`document.querySelector('section[aria-label="AI 筛选状态"]').textContent.includes('每日上限 0 次')`,'pause mode');
 assert.equal((await json('/api/ai/settings')).data.dailyLimit,0);
 await call('Emulation.setDeviceMetricsOverride',{width:414,height:896,deviceScaleFactor:1,mobile:true});
 await call('Page.navigate',{url:base+'/'});await until(`document.querySelector('#daily-ai-limit')?.value==='0'`,'mobile persistence');
 assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+2'),'Settings should fit mobile width');
 assert.equal(errors.length,0,JSON.stringify(errors));
 console.log(JSON.stringify({pass:true,invalidInput:true,configurableQuota:true,unlimited:true,paused:true,reload:true,mobile:true,coarseRequests:screened.latestScreening.ai_requests}));
}finally{
 const restored=await patch(original.dailyLimit);assert.equal(restored.response.status,200,'Restore the original quota');
 if(browser)await browser.close();
}
const after=(await json('/api/ai/status')).data;
assert.equal(after.dailyBudget.limit,original.dailyLimit);assert.equal(after.dailyBudget.used,before.dailyBudget.used);
assert.equal(after.usage.reduce((n,r)=>n+r.calls,0),before.usage.reduce((n,r)=>n+r.calls,0));
console.log(JSON.stringify({restoredLimit:after.dailyBudget.limit,usedUnchanged:after.dailyBudget.used,paidAiRequestsAdded:0}));
