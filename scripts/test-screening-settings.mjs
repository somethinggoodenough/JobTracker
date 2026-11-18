import assert from 'node:assert/strict';
import {startBrowser} from './cdp-browser.mjs';
const base=process.env.JOB_RADAR_URL||'http://127.0.0.1:4173';
async function json(path,init){const response=await fetch(base+path,{...init,signal:AbortSignal.timeout(60000)});return{response,data:await response.json()};}
const patch=payload=>json('/api/ai/screening',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
const original=(await json('/api/ai/screening')).data.settings;
assert(original?.version,'Settings API must be initialized');
const usage=(await json('/api/ai/status')).data;
const progress=(await json('/api/sync/progress')).data;
assert(!['running','cancelling'].includes(progress.run?.status),'Wait for sync before testing settings');
const payload=(settings,changes={})=>({coarse:settings.coarse,aiPrompt:settings.aiPrompt,version:settings.version,...changes});
let browser;
try{
 for(const aiPrompt of ['', 'x'.repeat(16001), null])assert.equal((await patch(payload(original,{aiPrompt}))).response.status,400);
 const custom=payload(original,{coarse:{...original.coarse,requiredKeywords:['Python','C++'],requireEarlyCareerSignals:false},aiPrompt:original.aiPrompt+'\nPrefer backend roles with Python; consider adjacent technical roles.'});
 const saved=await patch(custom);assert.equal(saved.response.status,200,JSON.stringify(saved.data));
 assert.equal((await patch(custom)).response.status,409,'Stale settings cannot overwrite a newer save');
 const persisted=(await json('/api/ai/screening')).data.settings;
 assert.deepEqual(persisted.coarse.requiredKeywords,['Python','C++']);assert.equal(persisted.aiPrompt,custom.aiPrompt);
 browser=await startBrowser('screening-settings');
 const {targetId}=await browser.call('Target.createTarget',{url:'about:blank'});
 const {sessionId}=await browser.call('Target.attachToTarget',{targetId,flatten:true});
 const call=(method,params={})=>browser.call(method,params,sessionId);
 const errors=[];browser.listeners.add(m=>{if(m.sessionId===sessionId&&m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);});
 await call('Page.enable');await call('Runtime.enable');
 async function evaluate(expression){const data=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(data.exceptionDetails)throw new Error(data.exceptionDetails.text);return data.result.value;}
 async function until(expression,label){for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out: '+label);}
 async function open(){await until(`document.readyState==='complete' && !!document.querySelector('#daily-ai-limit') && !!document.querySelector('button[aria-controls="screening-settings-editor"]')`,'hydrated settings button');await evaluate(`document.querySelector('button[aria-controls="screening-settings-editor"]').click()`);await until(`!!document.querySelector('#screening-ai-prompt')`,'loaded settings');}
 async function fill(selector,value){await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:base+'/'});await open();
 assert.equal(await evaluate(`document.querySelector('#screening-ai-prompt').value`),custom.aiPrompt);
 await fill('#screening-excludedKeywords','unpaid\ncontract');
 await fill('#screening-ai-prompt',custom.aiPrompt+'\nDo not reject merely for a nonstandard job title.');
 // Closing/reopening the panel preserves an unsaved draft.
 await evaluate(`document.querySelector('button[aria-controls="screening-settings-editor"]').click()`);await open();
 assert.equal(await evaluate(`document.querySelector('#screening-excludedKeywords').value`),'unpaid\ncontract');
 await evaluate(`document.querySelector('form[aria-label="粗筛条件与 AI Prompt 设置"]').requestSubmit()`);
 await until(`document.querySelector('#screening-settings-editor [role=status]')?.textContent.includes('已保存')`,'save prompt and filters');
 assert.deepEqual((await json('/api/ai/screening')).data.settings.coarse.excludedKeywords,['unpaid','contract']);
 await call('Page.reload');await open();assert.equal(await evaluate(`document.querySelector('#screening-excludedKeywords').value`),'unpaid\ncontract');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await call('Page.navigate',{url:base+'/'});await open();
 const layout=await evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+2&&r.width>0;}).slice(0,22).map(e=>({tag:e.tagName,id:e.id,class:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right}))})`);
 assert(layout.scroll<=layout.width+2,'Editor must fit mobile screen: '+JSON.stringify(layout));
 await evaluate(`[...document.querySelectorAll('#screening-settings-editor button')].find(b=>b.textContent==='恢复默认').click()`);
 assert.equal(await evaluate(`document.querySelector('#screening-experience-years').value`),'2');
 assert.equal(await evaluate(`document.querySelector('#screening-requiredKeywords').value`),'');
 assert.equal(errors.length,0,JSON.stringify(errors));
 console.log(JSON.stringify({pass:true,persisted:true,staleConflict:true,promptEditable:true,draftPreserved:true,reload:true,mobile:true,resetDraft:true,javascriptErrors:errors.length}));
}finally{
 const current=(await json('/api/ai/screening')).data.settings;
 const restored=await patch(payload(current,{coarse:original.coarse,aiPrompt:original.aiPrompt}));
 assert.equal(restored.response.status,200,'Restore original screening settings');
 if(browser)await browser.close();
}
const after=(await json('/api/ai/status')).data;
assert.equal(after.dailyBudget.used,usage.dailyBudget.used);assert.deepEqual(after.usage,usage.usage);
console.log(JSON.stringify({restored:true,paidAiRequestsAdded:0}));
