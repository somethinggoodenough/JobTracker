import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLocalTypeScript } from '../scripts/load-local-typescript.mjs';
const { shlab, huawei, kuaishouCampus, beisenPb, pinpoint, eightfoldLegacy, phenom, avature, staticArray, htmlDiv } = loadLocalTypeScript('lib/expanded-crawlers.ts');
const { canonicalUrl } = loadLocalTypeScript('lib/job-storage.ts');
const { crawlSource, normalizeSource } = loadLocalTypeScript('lib/crawler.ts');
const { oracle } = loadLocalTypeScript('lib/company-crawlers.ts');
const { withCrawlWindow, dayWindow } = loadLocalTypeScript('lib/crawl-window.ts');
const today = fn => withCrawlWindow(dayWindow(new Date('2026-11-18T12:00:00Z')), fn);
const source = { id: 900, name: 'Fixture', url: 'https://employer.test/careers', adapter: 'auto' };
const description = 'Build distributed backend systems using Python, C++ and Kubernetes.';
const ld = (id, date = '2026-11-18') => `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: `Engineer ${id}`, description, datePosted: date })}</script>`;

test('SPA posting routes remain distinct after URL deduplication', () => {
 const base = 'https://app.mokahr.com/apply/employer/123';
 assert.notEqual(canonicalUrl(base + '#/job/1'), canonicalUrl(base + '#/job/2'));
 assert.equal(canonicalUrl(base + '?utm_source=board#/job/1'), base + '#/job/1');
 assert.equal(canonicalUrl(base + '#contact'), base);
 assert.match(canonicalUrl('https://campus.kuaishou.cn/e/#/campus/job-info/123'), /job-info\/123$/);
});

test('miHoYo source normalization keeps campus and social boards separate', () => {
 const campus = 'https://jobs.mihoyo.com/#/campus/position';
 const social = 'https://jobs.mihoyo.com/#/position';
 for (const input of [campus, 'https://join.mihoyo.com/', 'https://campus.mihoyo.com/?channelToken=referral']) {
  assert.equal(normalizeSource(input).canonicalInput, campus);
  assert.equal(normalizeSource(input).adapter, 'mihoyo');
 }
 assert.equal(normalizeSource('https://jobs.mihoyo.com/').canonicalInput, social);
 assert.equal(canonicalUrl(social + '/42'), social + '/42');
 assert.notEqual(canonicalUrl(social + '/42'), canonicalUrl(social + '/43'));
 assert.equal(normalizeSource('https://jobs.mihoyo.com.example.org/#/position').adapter, 'auto');
});

test('miHoYo fetches fifty undated details per board, preserves official requirements and reports missing work', async t => {
 const calls = [];
 t.mock.method(globalThis, 'fetch', async (url, init) => {
  const endpoint = new URL(url);
  assert.equal(endpoint.hostname, 'ats.openout.mihoyo.com');
  assert.equal(init.method, 'POST');
  const body = JSON.parse(init.body);
  assert.deepEqual(body.channelDetailIds, [1]);
  calls.push([endpoint.pathname, body]);
  if (endpoint.pathname.endsWith('/list')) {
   assert.equal(body.pageNo, 1);
   assert.equal(body.pageSize, 50);
   return Response.json({ code: 0, data: { total: 51, list: Array.from({ length: 50 }, (_, i) => ({
    id: String(i + 1), title: 'Backend Engineer', jobNature: '全职', projectName: '春招', objectName: '应届毕业生',
   })) } });
  }
  if (body.id === '2' && body.hireType === 1) return Response.json({ code: 1, data: null });
  return Response.json({ code: 0, data: {
   id: body.id, title: 'Backend Engineer', description, jobRequire: '<p>Python and Kubernetes</p>',
   addressDetailList: [{ addressDetail: '上海' }, { addressDetail: '上海' }, { addressDetail: '杭州' }],
  } });
 });

 const campus = await crawlSource({ ...source, url: 'https://join.mihoyo.com/' });
 const social = await crawlSource({ ...source, url: 'https://jobs.mihoyo.com/#/position' });
 assert.equal(campus.length, 49);
 assert.equal(social.length, 50);
 assert.equal(calls.filter(([path]) => path.endsWith('/info')).length, 100);
 assert.equal(social.at(-1).externalId, '50');
 assert.equal(campus[0].location, '上海 · 杭州');
 assert.equal(campus[0].company, '米哈游');
 assert.equal(campus[0].applyUrl, 'https://jobs.mihoyo.com/#/campus/position/1');
 assert.match(campus[0].description, /招聘渠道：校招.*任职要求\nPython and Kubernetes/s);
 assert.doesNotMatch(social[0].description, /招聘渠道：校招/);
 assert(campus.concat(social).every(job => job.postedAt === null));
 assert.match(campus.warnings.join('\n'), /1 条职位详情读取失败/);
});

test('miHoYo returns an explicit error for incomplete board responses', async t => {
 t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 0, data: { total: 101, list: [] } }));
 await assert.rejects(crawlSource({ ...source, url: 'https://jobs.mihoyo.com/#/position' }), /分页不完整/);
});

test('SHLAB shares fifty undated selections across seven-row cursor pages and ignores creation dates', async t => {
 let pages = 0;
 t.mock.method(globalThis, 'fetch', async url => { const u = new URL(url); assert.equal(u.searchParams.get('limit'), '7'); const n = Number(u.searchParams.get('page_token') || 0); pages++;
  return Response.json({ errno: 0, data: { has_more: true, page_token: String(n + 1), items: Array.from({length: 7}, (_, i) => ({ id: String(n * 7 + i), title: 'AI Intern', create_time: '1795000000000', description, requirement: 'Python' })) } });
 });
 const jobs = await today(() => shlab({...source, url: 'https://www.shlab.org.cn/joinus/campus'}));
 assert.equal(jobs.length, 50); assert.equal(pages, 8); assert(jobs.every(j => j.postedAt === null)); assert.match(jobs[0].canonicalUrl, /detail\/0\?mode=campus/);
});

test('Huawei limits unknown parent jobs before downloading real intention JDs', async t => {
 let details = 0;
 t.mock.method(globalThis, 'fetch', async (url, init) => {
  const body = JSON.parse(init.body);
  if (url.includes('getJobPage')) return Response.json({status: 'SUCCESS', data: {pageVO: {totalRows: 109}, result: Array.from({length: 10}, (_, i) => ({jobId: (body.curPage - 1) * 10 + i, advertisementId: 1000 + (body.curPage - 1) * 10 + i, jobName: 'AI Intern', mainBusiness: 'See intentions', lastUpdateDate: '2026-11-18'}))}});
  details++; return Response.json({status: 'SUCCESS', data: [{positionIntention: 'AI Kernel', jobResponsibilities: description, jobDemand: 'Python, CUDA', jobPlaceName: '中国深圳'}]});
 });
 const jobs = await today(() => huawei(source)); assert.equal(jobs.length, 50); assert.equal(details, 50);
 assert.match(jobs[0].description, /CUDA/); assert.match(jobs[0].canonicalUrl, /advertisementId=1000/); assert.equal(jobs[0].postedAt, null);
});

test('Kuaishou searches both configured projects and traverses an unsorted old page', async t => {
 let pages = 0;
 t.mock.method(globalThis, 'fetch', async (_url, init) => { const b = JSON.parse(init.body); pages++; assert.deepEqual(b.recruitSubProjectCodes, ['campus','intern']);
  return Response.json({code: 0, result: {pages: 2, hasNextPage: b.pageNum === 1, list: [{id: b.pageNum, name: 'Backend Intern', description, positionDemand: 'Python', releaseTime: b.pageNum === 1 ? '2026-11-17 15:00:00' : '2026-11-18 20:00:00', updateTime: '2026-11-18 20:00:00', workLocationDicts: [{name: '北京'}]}]}});
 });
 const jobs = await today(() => kuaishouCampus(source, 'campus,intern'));
 assert.equal(pages, 2); assert.equal(jobs.length, 1); assert.equal(jobs[0].postedAt, '2026-11-18T12:00:00.000Z'); assert.match(jobs[0].canonicalUrl, /#\/campus\/job-info\/2/);
});

test('Beisen PB uses first publication date and requires complete detail data', async t => {
 t.mock.method(globalThis, 'fetch', async (url, init) => {
  assert.match(init.headers['content-type'], /form-urlencoded/);
  if (url.includes('listPositionDetail')) return Response.json({state: '200', data: {workContent: description, serviceCondition: 'Python required'}});
  return Response.json({state: '200', data: {positonNum: 2, pageForm: {pageData: [{postId: 1, postName: 'Intern', publishFirstDate: '2026-11-18 20:00:00'}, {postId: 2, postName: 'Old', publishFirstDate: '2026-10-01 20:00:00', publishDate: '2026-11-18 20:00:00'}]}}});
 });
 const jobs = await today(() => beisenPb({...source, url: 'https://hr.pcl.ac.cn/SU12345/pb/social.html'}));
 assert.equal(jobs.length, 1); assert.match(jobs[0].description, /Python required/); assert.match(jobs[0].canonicalUrl, /postId=1/);
});

test('Pinpoint accepts only fifty undated postings and includes responsibilities and requirements', async t => {
 t.mock.method(globalThis, 'fetch', async () => Response.json({data: Array.from({length: 83}, (_, id) => ({id, title: 'Engineer', url: `/en/postings/${id}`, description, key_responsibilities: 'Build cloud platforms', skills_knowledge_expertise: 'SQL and Python', location: {city: 'Austin'}}))}));
 const jobs = await today(() => pinpoint(source)); assert.equal(jobs.length, 50); assert.match(jobs[0].description, /SQL and Python/); assert.equal(jobs[0].location, 'Austin'); assert.equal(jobs[0].postedAt, null);
});

test('Netflix reads at most fifty details and uses detail datePosted instead of indexing timestamps', async t => {
 let details = 0;
 t.mock.method(globalThis, 'fetch', async url => {
  if (url.includes('/api/apply/v2/jobs')) { const start = Number(new URL(url).searchParams.get('start')); return Response.json({count: 433, positions: Array.from({length: 10}, (_, i) => ({id: start + i, name: 'Engineer', t_create: 1795000000}))}); }
  details++; return new Response(ld(url, details === 1 ? '2026-11-18' : '2026-10-01'));
 });
 const jobs = await today(() => eightfoldLegacy(source, 'netflix.com')); assert.equal(details, 50); assert.equal(jobs.length, 1); assert.match(jobs[0].description, /Kubernetes/);
});

test('Cisco traverses old relevance pages and fetches full JD only for today', async t => {
 let lists = 0, details = 0;
 t.mock.method(globalThis, 'fetch', async (url, init) => {
  if (url.endsWith('/widgets')) { const b = JSON.parse(init.body); lists++; return Response.json({refineSearch: {status: 200, totalHits: 2, data: {jobs: [{jobId: b.from + 1, title: 'Engineer', postedDate: b.from ? '2026-11-18' : '2026-11-01', descriptionTeaser: 'Not full JD', multi_location: ['US']} ]}}}); }
  details++; return new Response(ld(2));
 });
 const jobs = await today(() => phenom(source)); assert.equal(lists, 2); assert.equal(details, 1); assert.equal(jobs.length, 1); assert.match(jobs[0].description, /Kubernetes/); assert(!jobs[0].description.includes('teaser'));
});

test('Lenovo follows the actual ten-row page size and extracts nested complete HTML', async t => {
 let lists = 0;
 t.mock.method(globalThis, 'fetch', async url => {
  if (url.includes('SearchJobs')) { lists++; const offset = Number(new URL(url).searchParams.get('jobOffset'));
   return new Response(Array.from({length: 10}, (_, i) => `<article class="article article--result"><a href="/en_US/careers/JobDetail/Engineer/${offset + i}">Backend Intern</a><div class="article__header__text__subtitle"><span>United States</span><span>Posted ${offset ? '17' : '18'}-Nov-2026</span></div></article>`).join(''));
  }
  return new Response(`<h3>Description and Requirements</h3><div class="article__content__view__field__value"><div>${description}</div><div>Requirements: Python</div></div><div>Other page content</div>`);
 });
 const jobs = await today(() => avature({...source, url: 'https://jobs.lenovo.com/en_US/careers/SearchJobs'})); assert.equal(lists, 2); assert.equal(jobs.length, 10); assert.match(jobs[0].description, /Requirements: Python/); assert(!jobs[0].description.includes('Other page'));
});

test('Oracle profiles preserve employer site, origin, and canonical job links', async t => {
 let finder;
 t.mock.method(globalThis, 'fetch', async url => {
  if (url.includes('recruitingCEJobRequisitionDetails')) return Response.json({items: [{Title: 'Intern', ExternalDescriptionStr: description, ExternalPostedStartDate: '2026-11-18', PrimaryLocation: 'United States'}]});
  finder = new URL(url).searchParams.get('finder'); return Response.json({items: [{TotalJobsCount: 1, requisitionList: [{Id: 123, PostedDate: '2026-11-18'}]}]});
 });
 const jobs = await today(() => oracle({...source, name: 'JPMorgan Chase', url: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions'}, 'https://jpmc.fa.oraclecloud.com'));
 assert.match(finder, /siteNumber=CX_1001/); assert.equal(jobs[0].canonicalUrl, 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/123');
});

test('Static company data is parsed without code execution and nested HTML stays bounded', () => {
 assert.deepEqual(staticArray('let x=1,a=[{key:"0",title:"Engineer",requirements:{content:["Python"]}}];', ',a='), [{key:'0', title:'Engineer', requirements:{content:['Python']}}]);
 assert.throws(() => staticArray('x=[{key:evil()}]', 'x='));
 assert.equal(htmlDiv('<div><div>Full JD</div></div><div>Other</div>', 0), '<div><div>Full JD</div></div>');
 assert.throws(() => htmlDiv('<div>truncated', 0));
});

test('Provider errors and changed list schemas fail visibly', async t => {
 t.mock.method(globalThis, 'fetch', async () => Response.json({code: -1, errno: 400, status:'ERROR'}));
 for (const fn of [() => shlab(source), () => huawei(source), () => kuaishouCampus(source,'campus'), () => pinpoint(source), () => phenom(source)]) await assert.rejects(fn);
});
