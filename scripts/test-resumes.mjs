import assert from 'node:assert/strict';
import {startBrowser} from './cdp-browser.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {samplePdf} from '../tests/fixtures/resume-pdf.mjs';
const base=process.env.JOB_RADAR_URL||'http://127.0.0.1:4173';
const marker=`resume-check-${Date.now()}`, owned=new Set();
async function json(path,method='GET',body){
 const response=await fetch(base+path,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
 return{status:response.status,data:await response.json()};
}
const beforeJobs=(await json('/api/jobs')).data.pagination.total;
const beforeApplications=(await json('/api/applications')).data.pagination.total;
const beforeAi=(await json('/api/ai/status')).data;
assert(!['running','cancelling'].includes((await json('/api/sync/progress')).data.run?.status),'Run while sync is idle and the hourly scheduler is stopped.');
let browser;
try{
 assert.equal((await json('/api/resumes','POST',{name:'missing role'})).status,400);
 assert.equal((await json('/api/resumes/not-an-id')).status,400);
 const created=await json('/api/resumes','POST',{name:marker+'-api',target_role:'Backend intern',created_at:'2026-01-05T14:30:00Z',tech_stack:['Go','go','PostgreSQL'],content:'Private synthetic test body'});
 assert.equal(created.status,201,JSON.stringify(created.data));
 let record=created.data.resume;owned.add(record.id);
 assert.deepEqual(record.tech_stack,['Go','PostgreSQL']);
 const list=(await json('/api/resumes?q='+encodeURIComponent(marker))).data;
 assert.equal(list.pagination.total,1);assert.equal(list.pagination.pageSize,12);assert(!('content' in list.resumes[0]));
 assert.equal((await json(`/api/resumes/${record.id}`,'PATCH',{summary:'No version'})).status,400);
 const updated=await json(`/api/resumes/${record.id}`,'PATCH',{version:record.version,summary:'API verified'});
 assert.equal(updated.status,200);assert.equal(updated.data.resume.content,record.content);assert.equal(updated.data.resume.created_at,record.created_at);
 assert.equal((await json(`/api/resumes/${record.id}`,'PATCH',{version:record.version,name:'stale'})).status,409);
 assert.equal((await json(`/api/resumes/${record.id}`,'DELETE',{version:record.version})).status,409);
 record=updated.data.resume;
 assert.equal((await json('/api/resumes?q='+encodeURIComponent("' OR 1=1 --"))).data.pagination.total,0);
 browser=await startBrowser('resume-browser');
 const {targetId}=await browser.call('Target.createTarget',{url:'about:blank'});
 const {sessionId}=await browser.call('Target.attachToTarget',{targetId,flatten:true});
 const call=(method,params={})=>browser.call(method,params,sessionId),errors=[];
 browser.listeners.add(m=>{if(m.sessionId===sessionId&&m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
 await call('Page.enable');await call('Runtime.enable');
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 async function evaluate(expression){const d=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(d.exceptionDetails)throw new Error(d.exceptionDetails.exception?.description||d.exceptionDetails.text);return d.result.value;}
 async function until(expression,label){for(let i=0;i<120;i++){try{if(await evaluate(expression))return;}catch(error){if(!/context|Cannot find/i.test(error.message))throw error;}await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out: '+label);}
 async function click(expression){const point=await evaluate(`(()=>{const el=${expression};if(!el)throw Error('Control missing');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});}
 async function fill(expression,value){await evaluate(`(()=>{const el=${expression};const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
 const field=label=>`[...document.querySelectorAll('[role=dialog] label')].find(el=>el.textContent.startsWith(${JSON.stringify(label)})).querySelector('input,textarea')`;
 const button=text=>`[...document.querySelectorAll('main button')].find(el=>el.textContent.trim()===${JSON.stringify(text)})`;
 async function uploadPdf(filename,text){
  mkdirSync('outputs',{recursive:true});const file=path.resolve('outputs',filename);writeFileSync(file,samplePdf(text));
  const {root}=await call('DOM.getDocument');const {nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file][aria-label="上传简历 PDF"]'});
  await call('DOM.setFileInputFiles',{nodeId,files:[file]});
  await until(`document.querySelector('[role=dialog] iframe')?.src.startsWith('blob:')&&document.querySelector('[role=dialog]')?.textContent.includes(${JSON.stringify(filename)})`,'selected PDF preview');
 }
 const ready=`document.querySelector('main h1')?.textContent==='简历管理'&&!document.querySelector('main .animate-pulse')`;
 await call('Page.navigate',{url:base+'/'});await until(`!!document.querySelector('nav[aria-label="主目录"] a[href="/resumes"]')`,'directory');
 await click(`[...document.querySelectorAll('nav[aria-label="主目录"] a[href="/resumes"]')].find(el=>el.getClientRects().length)`);
 await until(ready,'resume directory');
 await click(button('新建简历'));await until(`!!document.querySelector('[role=dialog] input')`,'new resume editor');
 await uploadPdf(marker+'.pdf');
 await fill(field('简历名称'),marker+'-ui');await fill(field('目标岗位'),'AI Engineer new grad');
 await fill(field('简历创建时间'),'2026-01-05T09:30:00');await fill(field('简短说明'),'突出模型服务与部署项目');
 await fill(field('匹配技术栈'),'Python, python，PyTorch, CI/CD');await fill(field('简历正文'),'Synthetic resume text\nNo personal data.');
 await evaluate(`document.querySelector('[role=dialog] form').requestSubmit()`);
 await until(`!document.querySelector('[role=dialog]')&&document.querySelector('main')?.textContent.includes(${JSON.stringify(marker+'-ui')})`,'save resume');
 const found=(await json('/api/resumes?q='+encodeURIComponent(marker+'-ui'))).data;
 assert.equal(found.pagination.total,1);const uiId=found.resumes[0].id;owned.add(uiId);
 let ui=(await json(`/api/resumes/${uiId}`)).data.resume;
 assert.deepEqual(ui.tech_stack,['Python','PyTorch','CI/CD']);assert.equal(ui.created_at,'2026-01-05T14:30:00.000Z');
 assert.equal(ui.pdf_name,marker+'.pdf');assert(!('pdf_key' in ui));
 const pdfUrl=`${base}/api/resumes/${uiId}/pdf`;
 const storedPdf=await fetch(pdfUrl);assert.equal(storedPdf.status,200);assert.equal(storedPdf.headers.get('content-type'),'application/pdf');assert.deepEqual(new Uint8Array(await storedPdf.arrayBuffer()),samplePdf());
 const download=await fetch(pdfUrl+'?download=1');assert(download.headers.get('content-disposition').startsWith('attachment;'));await download.arrayBuffer();
 const partial=await fetch(pdfUrl,{headers:{Range:'bytes=0-7'}});assert.equal(partial.status,206);assert.equal(await partial.text(),'%PDF-1.4');
 assert.equal((await fetch(pdfUrl,{headers:{Range:'bytes=999999-'}})).status,416);
 await call('Page.reload');await until(ready,'reload saved list');
 await fill(`document.querySelector('input[aria-label="搜索简历"]')`,marker+'-ui');
 await until(`document.querySelectorAll('[data-resume-id]').length===1&&document.querySelector('[data-resume-id]')?.dataset.resumeId==='${uiId}'`,'search saved record');
 await click(`document.querySelector('[aria-label=${JSON.stringify('编辑简历 '+marker+'-ui')}]')`);
 await until(`document.querySelector('[role=dialog] textarea')?.value==='突出模型服务与部署项目'`,'load full record');
 await click(button('预览 PDF'));await until(`document.querySelector('[role=dialog] iframe')?.src.includes('/api/resumes/${uiId}/pdf')`,'saved PDF preview after reload');
 assert.equal(await evaluate(`${field('简历正文')}.value`),'Synthetic resume text\nNo personal data.');
 await fill(field('简短说明'),'适配推理平台岗位');await evaluate(`document.querySelector('[role=dialog] form').requestSubmit()`);
 await until(`!document.querySelector('[role=dialog]')&&document.querySelector('[data-resume-id="${uiId}"]')?.textContent.includes('适配推理平台岗位')`,'edit persisted');
 ui=(await json(`/api/resumes/${uiId}`)).data.resume;assert.equal(ui.created_at,'2026-01-05T14:30:00.000Z');assert.equal(ui.content,'Synthetic resume text\nNo personal data.');
 assert.equal(ui.pdf_name,marker+'.pdf');
 // A concurrent server edit must not replace the draft or be overwritten by a stale save.
 await click(`document.querySelector('[aria-label=${JSON.stringify('编辑简历 '+marker+'-ui')}]')`);
 await until(`!!document.querySelector('[role=dialog] textarea')`,'reopen editor');
 await fill(field('简短说明'),'unsaved draft');
 assert.equal((await json(`/api/resumes/${uiId}`,'PATCH',{version:ui.version,summary:'other window'})).status,200);
 await evaluate(`document.querySelector('[role=dialog] form').requestSubmit()`);
 await until(`document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('其他窗口')`,'conflict displayed');
 assert.equal(await evaluate(`${field('简短说明')}.value`),'unsaved draft');
 await click(`document.querySelector('[aria-label="关闭简历编辑"]')`);await until(`!document.querySelector('[role=dialog]')`,'close editor');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await call('Page.navigate',{url:base+'/applications'});await until(`document.querySelector('main h1')?.textContent==='申请职位状态'`,'mobile starting page');
 await click(`[...document.querySelectorAll('nav[aria-label="主目录"] a[href="/resumes"]')].find(el=>el.getClientRects().length)`);
 await until(ready,'mobile directory');assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+2'),'Mobile page overflow');
 await click(`document.querySelector('[aria-label=${JSON.stringify('编辑简历 '+marker+'-ui')}]')`);
 await until(`!!document.querySelector('[role=dialog] textarea')`,'mobile editor');
 await uploadPdf(marker+'-replacement.pdf','Replacement resume');
 assert(await evaluate(`document.querySelector('[role=dialog]').scrollWidth<=document.querySelector('[role=dialog]').clientWidth+2`),'Mobile editor overflow');
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
 await until(`!document.querySelector('[role=dialog]')`,'keyboard close');
 assert.equal((await json(`/api/resumes/${uiId}`)).data.resume.pdf_name,marker+'.pdf','Cancel must keep the saved PDF');
 await click(`document.querySelector('[aria-label=${JSON.stringify('编辑简历 '+marker+'-ui')}]')`);await until(`!!document.querySelector('[role=dialog] textarea')`,'replace saved PDF');
 await uploadPdf(marker+'-replacement.pdf','Replacement resume');await evaluate(`document.querySelector('[role=dialog] form').requestSubmit()`);await until(`!document.querySelector('[role=dialog]')`,'save replacement');
 assert.equal((await json(`/api/resumes/${uiId}`)).data.resume.pdf_name,marker+'-replacement.pdf');assert.deepEqual(new Uint8Array(await (await fetch(pdfUrl)).arrayBuffer()),samplePdf('Replacement resume'));
 await click(`document.querySelector('[aria-label=${JSON.stringify('编辑简历 '+marker+'-ui')}]')`);await until(`!!document.querySelector('[role=dialog] textarea')`,'remove PDF');
 await click(button('移除 PDF'));await evaluate(`document.querySelector('[role=dialog] form').requestSubmit()`);await until(`!document.querySelector('[role=dialog]')`,'save PDF removal');
 assert.equal((await fetch(pdfUrl)).status,404);assert.equal((await json(`/api/resumes/${uiId}`)).data.resume.content,'Synthetic resume text\nNo personal data.');
 await click(`document.querySelector('[aria-label=${JSON.stringify('编辑简历 '+marker+'-ui')}]')`);await until(`!!document.querySelector('[role=dialog] textarea')`,'attach existing resume');
 await uploadPdf(marker+'.pdf');await evaluate(`document.querySelector('[role=dialog] form').requestSubmit()`);await until(`!document.querySelector('[role=dialog]')`,'save existing attachment');
 await click(`document.querySelector('[aria-label=${JSON.stringify('删除简历 '+marker+'-ui')}]')`);
 await until(`!!document.querySelector('[role=alertdialog]')`,'delete confirmation');assert.equal((await json(`/api/resumes/${uiId}`)).status,200);
 await click(`[...document.querySelectorAll('[role=alertdialog] button')].find(el=>el.textContent==='取消')`);await until(`!document.querySelector('[role=alertdialog]')`,'cancel delete');
 assert.equal((await json(`/api/resumes/${uiId}`)).status,200);
 await click(`document.querySelector('[aria-label=${JSON.stringify('删除简历 '+marker+'-ui')}]')`);
 await click(`[...document.querySelectorAll('[role=alertdialog] button')].find(el=>el.textContent==='确认删除')`);
 await until(`!document.querySelector('[role=alertdialog]')&&!document.querySelector('[data-resume-id="${uiId}"]')`,'confirmed delete');
 assert.equal((await json(`/api/resumes/${uiId}`)).status,404);
 assert.equal(errors.length,0,JSON.stringify(errors));
 assert.equal((await fetch(pdfUrl)).status,404);
 console.log(JSON.stringify({pass:true,crud:true,metadata:true,nyTime:true,search:true,reload:true,pdfUpload:true,pdfPreview:true,pdfDownload:true,pdfReplace:true,pdfRemove:true,pdfCancel:true,pdfRanges:true,concurrentEditProtection:true,desktop:true,mobile:true,javascriptErrors:0}));
}finally{
 if(browser)await browser.close();
 // Discover a just-created UI fixture even if an assertion failed before its ID was recorded.
 const fixtures=(await json('/api/resumes?q='+encodeURIComponent(marker))).data.resumes||[];
 for(const row of fixtures)if(row.name.startsWith(marker))owned.add(row.id);
 for(const id of owned){const latest=await json(`/api/resumes/${id}`);if(latest.status===404)continue;assert.equal((await json(`/api/resumes/${id}`,'DELETE',{version:latest.data.resume.version})).status,200);}
}
assert.equal((await json('/api/jobs')).data.pagination.total,beforeJobs);
assert.equal((await json('/api/applications')).data.pagination.total,beforeApplications);
const afterAi=(await json('/api/ai/status')).data;
assert.equal(afterAi.usage.reduce((n,r)=>n+r.calls,0),beforeAi.usage.reduce((n,r)=>n+r.calls,0));
assert.equal((await json('/api/resumes?q='+encodeURIComponent(marker))).data.pagination.total,0);
console.log(JSON.stringify({testResumesRemoved:true,jobsAndApplicationsPreserved:true,paidAiRequestsAdded:0}));
