import fs from 'node:fs';
import {loadLocalTypeScript} from './load-local-typescript.mjs';
const {careerSession}=loadLocalTypeScript('lib/career-session.ts');
const session=careerSession(), post=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const tasks={
 tiktok:()=>fetch('https://api.lifeattiktok.com/api/v1/public/supplier/search/job/posts',{...post({recruitment_id_list:[],job_category_id_list:[],subject_id_list:[],location_code_list:[],keyword:'',limit:50,offset:0}),headers:{'user-agent':'Mozilla/5.0 (compatible; JobRadar/1.0)','content-type':'application/json',origin:'https://lifeattiktok.com',referer:'https://lifeattiktok.com/','website-path':'tiktok'}}),
 huawei:()=>session.fetch('https://career.huawei.com/reccampportal/services/portal/portalpub/getJob/newHr/page/50/1?curPage=1&pageSize=50&jobFamilyCode=&deptCode=&keywords=&searchType=1&orderBy=P_COUNT_DESC&jobType=1'),
 sugon:()=>session.fetch('https://sugon.zhiye.com/api/Jobad/GetJobAdPageList',post({PageIndex:0,PageSize:100,KeyWords:'',SpecialType:0,PortalId:'',DisplayFields:['Category','Kind','LocId','LocNames','PostDate','ClassificationOne','Duty','Require','JobAdId']})),
 moka:()=>session.fetch('https://app.mokahr.com/campus-recruitment/step/94905/'),
 gemdetail:async()=>{const d=JSON.parse(fs.readFileSync('outputs/public-api-probes/gem.txt'));return session.fetch('https://jobs.gem.com/groq/'+d[0].data.oatsExternalJobPostings.jobPostings[0].extId)},
 ibmfeed:()=>session.fetch('https://careers.ibm.com/en_US/careers/SearchJobs/feed/?jobRecordsPerPage=50'),
 ibmdetail:()=>session.fetch('https://careers.ibm.com/en_US/careers/JobDetail?jobId=136789'),
 baidu:()=>session.fetch('https://talent.baidu.com/jobs/list'),
 difyjs:async()=>{const h=fs.readFileSync('outputs/career-network/46.html','utf8');const src=[...h.matchAll(/<script[^>]+src="([^"]+)/g)].map(m=>m[1]).find(u=>!/analytics|gtag/i.test(u));return session.fetch(new URL(src,'https://join.dify.ai/').href)},
 ant:()=>session.fetch('https://hrcareersweb.antgroup.com/api/social/position/search',post({key:'',regions:'',categories:'',subCategories:'',bgCode:'',socialQrCode:'',pageIndex:1,pageSize:10,channel:'group_official_site',language:'zh'})),
 kuaishou:async()=>{const origin='https://zhaopin.kuaishou.cn';await(await session.fetch(origin+'/recruit/e/')).text();return session.fetch(origin+'/recruit/e/api/v1/open/positions/simple?pageNum=1&pageSize=10&positionNatureCode=C001&recruitProject=socialr',{headers:{referer:origin+'/recruit/e/'}})},
 salesforcedetail:()=>session.fetch('https://www.salesforce.com/company/careers/jobs/JR349189/forward-deployed-engineer/'),
 cambricon:()=>session.fetch('https://joinus.cambricon.com/'),
 baiduapi:async()=>{await(await session.fetch('https://talent.baidu.com/jobs/list')).text();return session.fetch('https://talent.baidu.com/httservice/getPostListNew',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded;charset=utf-8',referer:'https://talent.baidu.com/jobs/list',origin:'https://talent.baidu.com','x-requested-with':'XMLHttpRequest'},body:new URLSearchParams({recruitType:'GRADUATE',workPlace:'',pageSize:'50',keyWord:'',postType:'',curPage:'1',projectType:''}).toString()})},
 applecountry:()=>session.fetch('https://jobs.apple.com/en-us/search?location=united-states-USA&sort=newest&page=1'),
 kuaiua:()=>session.fetch('https://zhaopin.kuaishou.cn/recruit/e/api/v1/open/positions/simple?pageNum=1&pageSize=10&positionNatureCode=C001&recruitProject=socialr',{headers:{referer:'https://zhaopin.kuaishou.cn/recruit/e/','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 JobRadar/1.0'}}),
 workable:()=>session.fetch('https://apply.workable.com/api/v3/accounts/huggingface/jobs',post({query:'',location:[],department:[],worktype:[],remote:[]})),
 cambriconmoka:()=>session.fetch('https://app.mokahr.com/campus-recruitment/cambricon/44201'),
 meta:async()=>{const origin='https://www.metacareers.com',h=await(await session.fetch(origin+'/jobsearch/')).text(),lsd=h.match(/\["LSD",\[\],\{"token":"([^"]+)/)?.[1]||'';return session.fetch(origin+'/graphql',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-fb-lsd':lsd,origin,referer:origin+'/jobsearch/'},body:new URLSearchParams({av:'0',__user:'0',__a:'1',__comet_req:'31',lsd,doc_id:'40084319704492118',fb_api_caller_class:'RelayModern',fb_api_req_friendly_name:'CareersJobSearchResultsDataQuery',variables:JSON.stringify({search_input:{q:null,divisions:[],offices:[],roles:[],leadership_levels:[],saved_jobs:[],saved_searches:[],sub_teams:[],teams:[],is_leadership:false,is_remote_only:false,sort_by_new:true,results_per_page:null},viewasUserID:null,isLoggedIn:false})}).toString()})},
 metadetail:()=>session.fetch('https://www.metacareers.com/profile/job_details/1690022942358388'),
 baidujs:()=>session.fetch('https://talent-offical-static-prod.cdn.bcebos.com/hcm-recruitment/talent-offical-static-prod/client/static/js/Page.695b8d85.chunk.js'),
 baiduvendor:()=>session.fetch('https://talent-offical-static-prod.cdn.bcebos.com/hcm-recruitment/talent-offical-static-prod/client/static/js/vendor.e58a1081.chunk.js'),
 baidulist:()=>session.fetch('https://talent-offical-static-prod.cdn.bcebos.com/hcm-recruitment/talent-offical-static-prod/client/static/js/list.51594c2b.chunk.js'),
 baiducommon:()=>session.fetch('https://talent-offical-static-prod.cdn.bcebos.com/hcm-recruitment/talent-offical-static-prod/client/static/js/3085675597715898.c017c1dc.chunk.js'),
 mokadetail:()=>session.fetch('https://app.mokahr.com/api/outer/ats-apply/website/job',post({orgId:'step',siteId:94905,jobId:'ea6639c5-3565-4d48-89e7-1fce0956a14a',locale:'zh-CN'})),
};
fs.mkdirSync('outputs/extra-career-probes',{recursive:true});let i=0;const entries=Object.entries(tasks).filter(([name])=>!process.argv[2]||process.argv.slice(2).includes(name));
await Promise.all(Array.from({length:4},async()=>{while(i<entries.length){const [name,fn]=entries[i++];try{const r=await fn(),body=await r.text();fs.writeFileSync(`outputs/extra-career-probes/${name}.txt`,body);let d;try{d=JSON.parse(body)}catch{}console.log(JSON.stringify({name,status:r.status,bytes:body.length,keys:d&&Object.keys(d),preview:d?JSON.stringify(d,(k,v)=>typeof v==='string'?v.slice(0,80):v).slice(0,900):body.slice(0,60)}));}catch(e){console.log(JSON.stringify({name,error:e.message}));}}}));
