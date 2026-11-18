import { mkdirSync, writeFileSync } from 'node:fs';
const probes = {
  lightmatterjs: ['https://lightmatter.com/wp-content/themes/lightmatter/dist/main.11a1f71cc5aa5cab0d58.js?ver=1.0.0'],
  lightmatter: ['https://lightmatter.co/people/careers/'],
  figure: ['https://boards-api.greenhouse.io/v1/boards/figureai/jobs?content=true'],
  comeetfull: ['https://www.comeet.co/careers-api/2.0/company/43.001/positions?token=34110453411D4968234168209C31D49&details=true'],
  extra: ['https://api.ashbyhq.com/posting-api/job-board/fal-ai','https://boards-api.greenhouse.io/v1/boards/sambanovasystems/jobs?content=true','https://apply.workable.com/api/v1/widget/accounts/lightmatter'],
  appledetail: ['https://jobs.apple.com/en-us/details/114438346/th-specialist-part-time-seasonal'],
  comeetdetail: ['https://www.comeet.co/careers-api/2.0/company/43.001/positions/6D.76F?token=34110453411D4968234168209C31D49'],
  bytepost: ['https://jobs.bytedance.com/api/v1/search/job/posts'],
  feishupost: ['https://01ai.jobs.feishu.cn/api/v1/search/job/posts','https://vrfi1sk8a0.jobs.feishu.cn/api/v1/search/job/posts'],
  comeet: ['https://www.comeet.co/careers-api/2.0/company/43.001/positions?token=34110453411D4968234168209C31D49'],
  apple: ['https://jobs.apple.com/en-us/search?page=1&sort=newest'],
  feishu: ['https://01ai.jobs.feishu.cn/index/','https://vrfi1sk8a0.jobs.feishu.cn/index/'],
  details: ['https://careers.qualcomm.com/api/pcsx/position_details?position_id=446722089322&domain=qualcomm.com','https://eeho.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?onlyData=true&finder=ById;Id=342751'],
  smart: ['https://api.smartrecruiters.com/v1/companies/AristaNetworks/postings?limit=10','https://api.smartrecruiters.com/v1/companies/ServiceNow/postings?limit=10','https://api.smartrecruiters.com/v1/companies/LLNL/postings?limit=10'],
  boards: ['https://boards-api.greenhouse.io/v1/boards/databricks/jobs?content=true','https://boards-api.greenhouse.io/v1/boards/cloudflare/jobs?content=true','https://boards-api.greenhouse.io/v1/boards/groq/jobs?content=true','https://boards-api.greenhouse.io/v1/boards/scaleai/jobs?content=true','https://api.ashbyhq.com/posting-api/job-board/Perplexity'],
  eightfold: ['https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&start=0&num=10&sort_by=timestamp','https://careers.qualcomm.com/api/pcsx/search?domain=qualcomm.com&start=0&num=10&sort_by=timestamp'],
  fusion: ['https://eeho.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=CX_1,limit=10,sortBy=POSTING_DATES_DESC'],
  byteapi: ['https://jobs.bytedance.com/api/v1/search/job/posts?keyword=&limit=10&offset=0'],
  amazon: ['https://www.amazon.jobs/en/search.json?offset=0&result_limit=10&sort=recent'],
  google: ['https://www.google.com/about/careers/applications/jobs/results/?sort_by=date&page=1'],
  microsoft: ['https://jobs.careers.microsoft.com/global/en/search', 'https://gcsservices.careers.microsoft.com/search/api/v1/search?pg=1&pgSz=20&o=Recent'],
  tencent: ['https://careers.tencent.com/tencentcareer/api/post/Query?pageIndex=1&pageSize=10&language=zh-cn&area=cn'],
  oracle: ['https://careers.oracle.com/jobs/', 'https://eeho.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&finder=findReqs;siteNumber=CX_1,limit=10,sortBy=POSTING_DATES_DESC'],
  bytedance: ['https://jobs.bytedance.com/experienced/position'],
  alibaba: ['https://talent.alibaba.com/off-campus/position-list?lang=zh'],
  baidu: ['https://talent.baidu.com/jobs/list'],
  deepmind: ['https://deepmind.google/careers/'],
  meta: ['https://www.metacareers.com/jobs'],
  amd: ['https://careers.amd.com/careers-home/jobs', 'https://careers.amd.com/api/jobs?page=1'],
  qualcomm: ['https://careers.qualcomm.com/careers'],
  ibm: ['https://www.ibm.com/careers/search'],
  intel: ['https://jobs.intel.com/en'],
  salesforce: ['https://careers.salesforce.com/en/jobs/'],
};
mkdirSync('outputs/adapter-probes', { recursive: true });
const names = process.argv.slice(2);
const jobs = Object.entries(probes).filter(([name]) => !names.length || names.includes(name)).flatMap(([name, urls]) => urls.map((url, i) => ({name: `${name}-${i}`, url})));
let cursor = 0;
await Promise.all(Array.from({length:4}, async () => {
  while(cursor < jobs.length) {
    const {name,url} = jobs[cursor++];
    try {
      const post = name.startsWith('bytepost') || name.startsWith('feishupost');
      const response = await fetch(url, {signal:AbortSignal.timeout(25000), headers:{'user-agent':'JobRadar/1.0',accept:'application/json,text/html', ...(post?{'content-type':'application/json'}:{})}, ...(post?{method:'POST',body:JSON.stringify({keyword:'',limit:10,offset:0,job_category_id_list:[],location_code_list:[],subject_id_list:[],recruitment_id_list:[],portal_entrance:1})}:{})});
      const body = await response.text();
      writeFileSync(`outputs/adapter-probes/${name}.txt`, body);
      console.log(JSON.stringify({name,url,status:response.status,final:response.url,length:body.length,type:response.headers.get('content-type'),sample:body.slice(0,150)}));
    } catch(error) { console.log(JSON.stringify({name,url,error:error.message,cause:error.cause?.code})); }
  }
}));
