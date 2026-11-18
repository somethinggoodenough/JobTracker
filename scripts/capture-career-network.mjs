import fs from 'node:fs';
import {startBrowser} from './cdp-browser.mjs';
const audit=JSON.parse(fs.readFileSync('outputs/requested-adapter-audit.json','utf8')).sources;
const extras=[
 {i:53,name:'NetEase jobs',url:'https://hr.163.com/job-list.html'},
 {i:54,name:'XHS jobs',url:'https://job.xiaohongshu.com/social/position'},
 {i:55,name:'ByteDance campus',url:'https://jobs.bytedance.com/campus/position/list'},
 {i:56,name:'Baichuan root',url:'https://cq6qe6bvfr6.jobs.feishu.cn/'},
 {i:57,name:'Sugon',url:'https://sugon.zhiye.com/jobs'},
 {i:58,name:'AliCloud social',url:'https://careers.aliyun.com/off-campus/position-list'},
 {i:59,name:'Meituan jobs',url:'https://zhaopin.meituan.com/web/position'},
 {i:60,name:'Ant jobs',url:'https://talent.antgroup.com/off-campus?search'},
 {i:40,name:'Groq Gem',url:'https://jobs.gem.com/groq'},
 {i:41,name:'ModelBest Feishu',url:'https://modelbest.jobs.feishu.cn/campus/position/list'},
 {i:42,name:'MiniMax Feishu',url:'https://vrfi1sk8a0.jobs.feishu.cn/379481/position/list'},
 {i:43,name:'Baichuan Feishu',url:'https://cq6qe6bvfr6.jobs.feishu.cn/position/list'},
 {i:44,name:'SenseTime Feishu',url:'https://hr-jobs.sensetime.com/edu/position/list'},
 {i:45,name:'StepFun Moka',url:'https://app.mokahr.com/campus-recruitment/step/94905'},
 {i:46,name:'Dify',url:'https://join.dify.ai/roles.html'},
 {i:47,name:'Alibaba campus',url:'https://campus-talent.alibaba.com/campus/position'},
 {i:48,name:'AliCloud',url:'https://careers.alibabacloud.com/campus/position-list?lang=zh'},
 {i:49,name:'iFlytek jobs',url:'https://iflytek.zhiye.com/jobs'},
 {i:50,name:'IBM Avature',url:'https://careers.ibm.com/en_US/careers/SearchJobs'},
 {i:51,name:'Salesforce Workday',url:'https://salesforce.wd12.myworkdayjobs.com/External_Career_Site'},
 {i:52,name:'Xiaomi jobs',url:'https://hr.xiaomi.com/website/opportunities.html'},
];
const ids=process.argv.slice(2).map(Number),tasks=[...audit,...extras].filter(s=>ids.includes(s.i));
fs.mkdirSync('outputs/career-network',{recursive:true});const browser=await startBrowser();let cursor=0;
try{await Promise.all(Array.from({length:3},async()=>{while(cursor<tasks.length){const task=tasks[cursor++],requests=new Map(),responses=[],done=[];let sessionId,targetId;
 try{
  ({targetId}=await browser.call('Target.createTarget',{url:'about:blank'}));({sessionId}=await browser.call('Target.attachToTarget',{targetId,flatten:true}));
  const call=(method,params={})=>browser.call(method,params,sessionId);
  const listener=m=>{if(m.sessionId!==sessionId)return;
   if(m.method==='Network.requestWillBeSent')requests.set(m.params.requestId,{url:m.params.request.url,method:m.params.request.method,body:m.params.request.postData,headers:Object.fromEntries(Object.entries(m.params.request.headers||{}).filter(([k])=>/^(x-|website|content-type|origin|referer)/i.test(k)))});
   if(m.method==='Network.responseReceived'&&['XHR','Fetch'].includes(m.params.type)&&/job|position|career|search|recruit|graphql|api|req/i.test(m.params.response.url)&&!/analytics|log|monitor|collect|track|beacon|sentry|captcha|report/i.test(m.params.response.url))responses.push({id:m.params.requestId,status:m.params.response.status,url:m.params.response.url});
   if(m.method==='Network.loadingFinished')done.push(m.params.requestId);
  };browser.listeners.add(listener);
  await call('Page.enable');await call('Network.enable');await call('Runtime.enable');await call('Page.navigate',{url:task.url});await new Promise(r=>setTimeout(r,6500));
  const dom=await call('Runtime.evaluate',{expression:'({url:location.href,title:document.title,text:document.body.innerText.slice(0,2500),html:document.documentElement.outerHTML,aesIv:window.TurboApply?.data?.aesIv})',returnByValue:true});
  const value=dom.result.value||{};if(value.html)fs.writeFileSync(`outputs/career-network/${task.i}.html`,value.html);
  for(const response of responses.filter(r=>done.includes(r.id))){try{const body=await call('Network.getResponseBody',{requestId:response.id});const text=body.base64Encoded?Buffer.from(body.body,'base64').toString('utf8'):body.body;
   response.file=`${task.i}-${responses.indexOf(response)}.txt`;fs.writeFileSync('outputs/career-network/'+response.file,text);response.bytes=text.length;response.request=requests.get(response.id);
   if(response.request?.method==='POST'&&!response.request.body){try{response.request.body=(await call('Network.getRequestPostData',{requestId:response.id})).postData;}catch{}}
  }catch{}}
  const result={i:task.i,name:task.name,url:task.url,finalUrl:value.url,title:value.title,text:value.text,aesIv:value.aesIv,responses};fs.writeFileSync(`outputs/career-network/${task.i}.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify({i:task.i,name:task.name,title:value.title,text:value.text?.slice(0,180),responses:responses.map(r=>({url:r.url,status:r.status,bytes:r.bytes,file:r.file}))}));
  browser.listeners.delete(listener);
 }catch(e){console.log(JSON.stringify({i:task.i,name:task.name,error:e.message}));}
 finally{if(targetId)await browser.call('Target.closeTarget',{targetId}).catch(()=>{});}
}}));}finally{await browser.close();}
