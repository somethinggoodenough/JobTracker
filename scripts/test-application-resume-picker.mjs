import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {startBrowser} from './cdp-browser.mjs';

export async function verifyApplicationResumePicker({base,applicationId,key,fixtures,api}) {
 const browser=await startBrowser('application-resume-browser');
 try{
  const {targetId}=await browser.call('Target.createTarget',{url:'about:blank'});const {sessionId}=await browser.call('Target.attachToTarget',{targetId,flatten:true});
  const call=(method,params={})=>browser.call(method,params,sessionId),errors=[];
  browser.listeners.add(m=>{if(m.sessionId===sessionId&&m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  async function evaluate(expression){const data=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(data.exceptionDetails)throw new Error(data.exceptionDetails.exception?.description||data.exceptionDetails.text);return data.result.value;}
  async function until(expression,label){for(let i=0;i<120;i++){try{if(await evaluate(expression))return;}catch(error){if(!/context|Cannot find/i.test(error.message))throw error;}await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out: '+label+'; '+JSON.stringify(await evaluate(`({url:location.pathname,cards:document.querySelectorAll('main button.job-card').length,loading:!!document.querySelector('main .animate-pulse'),search:document.querySelector('input[aria-label="搜索申请记录"]')?.value})`)));}
  async function fill(selector,value){await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
  const picker='select[aria-label="申请使用的简历"]',search='input[aria-label="搜索可选简历"]';
  async function open(){await until(`!!document.querySelector('input[aria-label="搜索申请记录"]')&&!document.querySelector('main .animate-pulse')&&!!document.querySelector('main button.job-card')`,'application search ready');await fill('input[aria-label="搜索申请记录"]',key);await until(`document.querySelectorAll('main button.job-card').length===1&&document.querySelector('main button.job-card').textContent.includes(${JSON.stringify(key)})`,'fixture card');await evaluate(`document.querySelector('main button.job-card').click()`);await until(`!!document.querySelector(${JSON.stringify(picker)})&&!document.querySelector(${JSON.stringify(picker)}).disabled`,'resume picker');}
  async function save(){await evaluate(`document.querySelector('[role=dialog] form').requestSubmit()`);await until(`document.querySelector('[role=dialog] [role=status]')?.textContent==='已保存'`,'save selected resume');}
  const selected=fixtures[0],chosen=`${selected.id}:${selected.version}`;
  await call('Page.navigate',{url:base+'/applications'});await open();await fill(search,key+' picker');
  await until(`document.querySelector('section[aria-label="从简历库选择"]')?.textContent.includes('共 14 份')&&!document.querySelector(${JSON.stringify(picker)}).disabled`,'search fourteen records');
  assert(!await evaluate(`!!document.querySelector(${JSON.stringify(picker)}+' option[value="${chosen}"]')`),'The oldest record should require pagination');
  await evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(el=>el.textContent==='下一页简历').click()`);
  await until(`!!document.querySelector(${JSON.stringify(picker)}+' option[value="${chosen}"]')`,'second page option');
  await fill(picker,chosen);await until(`document.querySelector('[aria-label="已选申请简历"]')?.textContent.includes(${JSON.stringify(selected.name)})`,'selection metadata');
  await fill('textarea[aria-label="简历补充说明"]','Preserved application notes');await save();
  let detail=await api('/api/applications/'+applicationId);assert.equal(detail.application.resume_id,selected.id);assert.equal(detail.application.resume,'Preserved application notes');
  await call('Page.reload');await open();assert.equal(await evaluate(`document.querySelector(${JSON.stringify(picker)}).value`),chosen,'Saved option survives reload even outside the first library page');
  const changed=await api('/api/resumes/'+selected.id,'PATCH',{version:selected.version,name:key+' renamed resume'});assert.equal(changed.status,200);
  await evaluate(`document.querySelector('button[aria-label="刷新简历列表"]').click()`);await until(`!document.querySelector(${JSON.stringify(picker)}).disabled`,'refresh library');assert.equal(await evaluate(`document.querySelector(${JSON.stringify(picker)}).value`),chosen,'Refresh must keep the saved version');
  const next=`${selected.id}:${changed.resume.version}`;await until(`!!document.querySelector(${JSON.stringify(picker)}+' option[value="${next}"]')`,'current library version');await fill(picker,next);await save();
  assert.equal((await api('/api/applications/'+applicationId)).application.resume_snapshot.version,2);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+2'),'Picker should fit mobile width');
  await evaluate(`document.querySelector('[role=dialog]').scrollTop=0`);const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync('outputs/application-resume-picker-mobile.png',Buffer.from(shot.data,'base64'));
  // Failed library loading cannot silently clear an existing saved selection.
  await call('Network.setBlockedURLs',{urls:[base+'/api/resumes?*']});await evaluate(`document.querySelector('button[aria-label="刷新简历列表"]').click()`);await until(`!!document.querySelector('section[aria-label="从简历库选择"] [role=alert]')`,'library error');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(picker)}).value`),next);await save();assert.equal((await api('/api/applications/'+applicationId)).application.resume_snapshot.version,2);
  await call('Network.setBlockedURLs',{urls:[]});await evaluate(`document.querySelector('button[aria-label="刷新简历列表"]').click()`);await until(`!document.querySelector(${JSON.stringify(picker)}).disabled`,'retry library');
  await fill(picker,'');await save();detail=await api('/api/applications/'+applicationId);assert.equal(detail.application.resume_id,null);assert.equal(detail.application.resume_snapshot,null);assert.equal(detail.application.resume,'Preserved application notes');
  assert.equal(errors.length,0,JSON.stringify(errors));console.log(JSON.stringify({resumePicker:true,search:true,secondPage:true,reload:true,versionSelection:true,libraryFailurePreservesSelection:true,clearSelection:true,mobile:true,javascriptErrors:0}));
 }finally{await browser.close();}
}
