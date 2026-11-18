// Browser-level navigation regression check using a separate, headless Chrome profile.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync} from 'node:fs';
import path from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:4173';
const executable=process.env.CHROME_PATH||[
 'C:/Program Files/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
if(!executable)throw new Error('Set CHROME_PATH to an installed Chromium browser.');
const profile=path.resolve('outputs',`navigation-browser-${Date.now()}`);mkdirSync(profile,{recursive:true});
const browser=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe'],windowsHide:true});
let socket;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 const endpoint=await new Promise((resolve,reject)=>{
  let output='';const timer=setTimeout(()=>reject(new Error('Browser startup timed out')),15000);
  browser.on('error',e=>{clearTimeout(timer);reject(e);});browser.on('exit',code=>{clearTimeout(timer);reject(new Error(`Browser exited ${code}`));});
  browser.stderr.on('data',buffer=>{output+=buffer.toString();const match=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
 });
 socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let sequence=0;const pending=new Map(),errors=[],requests=[];
 socket.addEventListener('message',event=>{
  const message=JSON.parse(String(event.data));
  if(message.id){const p=pending.get(message.id);if(p){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(new Error(JSON.stringify(message.error))):p.resolve(message.result);}}
  if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
  if(message.method==='Network.requestWillBeSent')requests.push(message.params.request.url);
 });
 function call(method,params={},sessionId){return new Promise((resolve,reject)=>{
  const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},15000);
  pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,sessionId}));
 });}
 const {targetId}=await call('Target.createTarget',{url:'about:blank'});
 const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
 const page=(method,params)=>call(method,params,sessionId);
 await page('Page.enable');await page('Runtime.enable');await page('Network.enable');
 async function evaluate(expression){const result=await page('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);return result.result.value;}
 async function until(expression,label){for(let i=0;i<80;i++){try{if(await evaluate(`Boolean(${expression})`))return;}catch(e){if(!/context|Cannot find/i.test(e.message))throw e;}await pause(100);}throw new Error(`Timed out: ${label}; ${JSON.stringify(await evaluate('({url:location.href,title:document.querySelector("main h1")?.textContent,body:document.body.innerText.slice(-500)})'))}; errors=${JSON.stringify(errors)}; requests=${JSON.stringify(requests.slice(-15))}`);}
 async function clickLink(href){
  const point=await evaluate(`(()=>{const links=[...document.querySelectorAll('nav[aria-label="主目录"] a')];const a=links.find(a=>a.getAttribute('href')===${JSON.stringify(href)}&&a.getClientRects().length);if(!a)return null;const r=a.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  assert(point,`Visible navigation link ${href}`);
  await page('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  await page('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
 }
 await page('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await page('Page.navigate',{url:base+'/'});
 await until('document.readyState==="complete" && document.querySelector("main h1") && !document.querySelector("main .animate-pulse")','initial hydration/jobs');
 await until(`document.querySelector('section[aria-label="AI 筛选状态"]')?.textContent.includes('每日上限') && document.querySelector('#daily-ai-limit')`,'configurable daily model budget displayed');
 assert(await evaluate(`document.querySelector('section[aria-label="AI 筛选状态"]').textContent.includes('待审核队列')`),'Queue information must appear');
 if(await evaluate('!!document.querySelector("main .job-card > button")')){
  assert(await evaluate(`!!document.querySelector('main [aria-label="AI 岗位分类"]')`),'Classification badges must appear');
  await evaluate('document.querySelector("main .job-card > button").click()');
  await until(`!!document.querySelector('section[aria-label="JD 技术栈与筛选依据"]')`,'JD technology stack and evidence');
  await evaluate(`document.querySelector('button[aria-label="关闭职位详情"]').click()`);
  console.log('Classification badges and JD technology stack OK');
 }
 await pause(500);
 await clickLink('/applications');
 await until('location.pathname==="/applications" && document.querySelector("main h1")?.textContent==="申请职位状态"','click applications');
 await until(`!!document.querySelector('input[aria-label="搜索申请记录"]') && !document.querySelector("main .animate-pulse")`,'application list loaded');
 console.log('Desktop applications navigation OK');
 await clickLink('/');await until('location.pathname==="/" && !!document.querySelector("main h1") && !document.querySelector("main .animate-pulse")','back to jobs');
 console.log('Desktop return to jobs OK');
 for(const href of ['/resumes','/sources','/runs']){
  await clickLink(href);await until(`location.pathname===${JSON.stringify(href)} && document.readyState==="complete"`,'directory '+href);
  if(href==='/resumes')await until(`document.querySelector('main h1')?.textContent==='简历管理' && !!document.querySelector('input[aria-label="搜索简历"]')`,'resume directory');
 }
 await clickLink('/');await until('location.pathname==="/" && !!document.querySelector("main h1") && !document.querySelector("main .animate-pulse")','return from other pages');
 await page('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await clickLink('/applications');
 await until('location.pathname==="/applications" && document.querySelector("main h1")?.textContent==="申请职位状态"','mobile applications');
 console.log('Mobile applications navigation OK');
 await evaluate('history.back()');await until('location.pathname==="/" && !!document.querySelector("main h1") && !document.querySelector("main .animate-pulse")','browser back');
 console.log('Browser back OK');
 assert.equal(errors.length,0,JSON.stringify(errors));
 console.log(JSON.stringify({pass:true,desktopClick:true,mobileClick:true,returnToJobs:true,javascriptErrors:errors.length}));
 await call('Browser.close');
}finally{socket?.close();browser.kill();}
