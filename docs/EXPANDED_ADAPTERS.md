# 中国剩余来源与追加公司适配

本地 Worker 实测时间：2026-11-18T10:15:19.079Z。

本轮共 56 个来源：51 个可解析，5 个未接通。

计数是通过日期窗口的抓取候选数，尚未经过粗筛和 DeepSeek，不代表新增职位数。0 条且接口正常表示今天没有候选，不是解析失败。验证只更新来源健康状态和入口，不调用模型或写入职位。

## 中国剩余 30 家

| 公司 | 本地实测 | 抓取候选数 | 适配器 | 说明 |
|---|---|---:|---|---|
| [360](https://360campus.zhiye.com/jobs) | 可解析 | 1 | beisen | 完整 JD 可读取 |
| [摩尔线程](https://mthreads.zhiye.com/jobs) | 可解析 | 1 | beisen | 完整 JD 可读取 |
| [昆仑芯](https://kunlunxin1.zhiye.com/jobs) | 可解析 | 0 | beisen | 接口正常，本轮无当天职位 |
| [并行科技](https://paratera.zhiye.com/jobs) | 可解析 | 1 | beisen | 完整 JD 可读取 |
| [海光信息](https://app.mokahr.com/campus-recruitment/hygon/169939) | 可解析 | 0 | moka | 接口正常，本轮无当天职位 |
| [壁仞科技](https://app.mokahr.com/campus-recruitment/biren/44727) | 可解析 | 0 | moka | 接口正常，本轮无当天职位 |
| [天数智芯](https://app.mokahr.com/campus-recruitment/iluvatar/44785) | 可解析 | 0 | moka | 接口正常，本轮无当天职位 |
| [北京智源研究院 BAAI](https://app.mokahr.com/campus-recruitment/baai/42174) | 可解析 | 0 | moka | 接口正常，本轮无当天职位 |
| [沐曦](https://recruitment.metax-tech.com/campus-recruitment/metax-tech/58131) | 可解析 | 0 | moka | 接口正常，本轮无当天职位 |
| [第四范式](https://app.mokahr.com/campus-recruitment/4paradigm/58145) | 可解析 | 0 | moka | 接口正常，本轮无当天职位 |
| [燧原科技](https://app.mokahr.com/campus-recruitment/enflame/168420) | 可解析 | 0 | moka | 接口正常，本轮无当天职位 |
| [DeepSeek 深度求索](https://app.mokahr.com/social-recruitment/high-flyer/140576) | 可解析 | 36 | moka | 发布日期未知：本轮最多取前 50 条；通过筛选后按首次发现时间保留 7 天，不计入今日发布 |
| [月之暗面 Moonshot（Kimi）](https://app.mokahr.com/apply/moonshot/148506) | 可解析 | 2 | moka | 完整 JD 可读取 |
| [智谱 Z.ai](https://app.mokahr.com/social-recruitment/zphz/148983) | 可解析 | 1 | moka | 完整 JD 可读取 |
| [零一万物](https://01ai.jobs.feishu.cn/index/position/list) | 可解析 | 0 | feishu | 接口正常，本轮无当天职位 |
| [无问芯穹](https://infinigence.jobs.feishu.cn/infinigence/position/list) | 可解析 | 0 | feishu | 接口正常，本轮无当天职位 |
| [智元机器人](https://agirobot.jobs.feishu.cn/socialrecruitment/position/list) | 可解析 | 0 | feishu | 接口正常，本轮无当天职位 |
| [生数科技](https://shengshu.jobs.feishu.cn/index/position/list) | 可解析 | 0 | feishu | 接口正常，本轮无当天职位 |
| [清程极智](https://chitu-ai.jobs.feishu.cn/index/position/list) | 可解析 | 0 | feishu | 接口正常，本轮无当天职位 |
| [上海人工智能实验室](https://www.shlab.org.cn/joinus/campus) | 可解析 | 50 | shlab | 发布日期未知：本轮最多取前 50 条；通过筛选后按首次发现时间保留 7 天，不计入今日发布 |
| [鹏城实验室](https://hr.pcl.ac.cn/SU62b979a5bef57c0f6fb046d7/pb/social.html) | 可解析 | 0 | beisen_pb | 接口正常，本轮无当天职位 |
| [之江实验室](https://talents.zhejianglab.com/SU6456170be84cd420e37a68c4/pb/school.html) | 可解析 | 0 | beisen_pb | 接口正常，本轮无当天职位 |
| [华为](https://career.huawei.com/cn/campus-recruitment-job-list) | 可解析 | 50 | huawei | 发布日期未知：本轮最多取前 50 条；通过筛选后按首次发现时间保留 7 天，不计入今日发布 |
| [快手](https://campus.kuaishou.cn/recruit/campus/e/) | 可解析 | 0 | kuaishou_campus | 接口正常，本轮无当天职位 |
| [潞晨科技](https://www.luchentech.com/join) | 可解析 | 4 | luchentech | 发布日期未知：本轮最多取前 50 条；通过筛选后按首次发现时间保留 7 天，不计入今日发布 |
| [硅基流动 SiliconFlow](https://siliconflow.cn/careers) | 未接通 | 0 | auto | 官网招聘入口转回首页，仅确认公开投递邮箱 talent@siliconflow.cn；未发现可解析的完整职位列表 |
| [爱诗科技 PixVerse](https://pixverse.ai/en/careers) | 未接通 | 0 | auto | 官网职位入口跳转 LinkedIn 公司页，目前未找到可匿名解析的完整职位列表 |
| [趋境科技](https://approaching-ai.com/) | 未接通 | 0 | auto | 已更正官网；招募入口目前仅提供联系渠道，没有公开完整职位列表 |
| [中科加禾](https://www.xcoresigma.com/) | 未接通 | 0 | auto | 已更正官网；目前未发现公开完整职位列表或可用招聘 ATS |
| [实在智能](https://www.ai-indeed.com/apply) | 未接通 | 0 | auto | 官网为招聘介绍及投递邮箱，未提供可解析的完整职位列表 |

## 用户追加的 26 家

| 公司 | 本地实测 | 抓取候选数 | 适配器 | 说明 |
|---|---|---:|---|---|
| [Netflix](https://explore.jobs.netflix.net/careers) | 可解析 | 5 | eightfold_legacy | 完整 JD 可读取 |
| [Airbnb](https://job-boards.greenhouse.io/airbnb) | 可解析 | 1 | greenhouse | 完整 JD 可读取 |
| [LinkedIn](https://careers.smartrecruiters.com/LinkedIn3) | 可解析 | 2 | smartrecruiters | 完整 JD 可读取 |
| [Zoom](https://zoom.wd5.myworkdayjobs.com/zoom) | 可解析 | 1 | workday | 完整 JD 可读取 |
| [Roblox](https://job-boards.greenhouse.io/roblox) | 可解析 | 0 | greenhouse | 接口正常，本轮无当天职位 |
| [Epic Games](https://job-boards.greenhouse.io/epicgames) | 可解析 | 0 | greenhouse | 接口正常，本轮无当天职位 |
| [Palantir](https://jobs.lever.co/palantir) | 可解析 | 0 | lever | 接口正常，本轮无当天职位 |
| [C3.ai](https://job-boards.greenhouse.io/c3iot) | 可解析 | 0 | greenhouse | 接口正常，本轮无当天职位 |
| [P&G](https://pg.wd5.myworkdayjobs.com/1000) | 可解析 | 3 | workday | 完整 JD 可读取 |
| [Walmart](https://walmart.wd504.myworkdayjobs.com/WalmartExternal) | 可解析 | 3 | workday | 完整 JD 可读取 |
| [Moderna](https://modernatx.wd1.myworkdayjobs.com/M_tx) | 可解析 | 1 | workday | 完整 JD 可读取 |
| [Vast.ai](https://jobs.ashbyhq.com/vastai) | 可解析 | 0 | ashby | 接口正常，本轮无当天职位 |
| [DoorDash](https://job-boards.greenhouse.io/doordashusa) | 可解析 | 0 | greenhouse | 接口正常，本轮无当天职位 |
| [Uber](https://iaziqy.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/UberCareers/jobs) | 可解析 | 2 | oracle | 完整 JD 可读取 |
| [Visa](https://visa.wd5.myworkdayjobs.com/Visa) | 可解析 | 12 | workday | 完整 JD 可读取 |
| [Brivo](https://careers.brivo.com/en/opportunities) | 可解析 | 50 | pinpoint | 发布日期未知：本轮最多取前 50 条；通过筛选后按首次发现时间保留 7 天，不计入今日发布 |
| [DocuSign](https://careers.docusign.com/jobs) | 可解析 | 3 | jibe | 完整 JD 可读取 |
| [Lenovo](https://jobs.lenovo.com/en_US/careers/SearchJobs) | 可解析 | 4 | avature | 完整 JD 可读取 |
| [GlobalFoundries](https://globalfoundries.eightfold.ai/careers) | 可解析 | 0 | eightfold | 接口正常，本轮无当天职位 |
| [Anduril](https://job-boards.greenhouse.io/andurilindustries) | 可解析 | 0 | greenhouse | 接口正常，本轮无当天职位 |
| [CloudLinux](https://apply.workable.com/cloudlinux-1/) | 可解析 | 0 | workable | 接口正常，本轮无当天职位 |
| [JPMorgan Chase](https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions) | 可解析 | 27 | oracle | 完整 JD 可读取 |
| [Morgan Stanley](https://morganstanley.eightfold.ai/careers) | 可解析 | 0 | eightfold | 接口正常，本轮无当天职位 |
| [Cisco](https://careers.cisco.com/global/en/search-results) | 可解析 | 0 | phenom | 接口正常，本轮无当天职位 |
| [Akamai](https://jobs.akamai.com/en/sites/CX_1) | 可解析 | 2 | oracle | 完整 JD 可读取 |
| [Nuro](https://job-boards.greenhouse.io/nuro) | 可解析 | 0 | greenhouse | 接口正常，本轮无当天职位 |

## 接入和范围

- Palantir 复用原有来源；Akami 按 Akamai 接入；Vast.ai 与原有 VAST Data 分开。公司名称不决定职位国家，仍由每个职位的地点和 JD 判断。
- 有可靠发布日期只抓纽约当天；缺日期每个来源跨页共享 50 条名额。创建、更新、索引时间均不冒充发布日期。
- 部分中国来源采用可公开读取的校园入口，覆盖校招及实习，不宣称覆盖该公司的所有社会招聘。快手同时查询当前校招与实习项目，年度项目编号配置在公司配置中。
- 华为先筛选父职位，再读取岗位意向中的真实职责和要求；列表中的占位文字不能代替 JD。
- SHLAB 使用服务端支持的 7 条分页；鹏城与之江调用匿名公开北森 pb API，不依赖页面挑战或私人登录。
- Netflix 使用仍可用的公开 legacy 搜索 API，最多读取前 50 个无日期列表项的详情，再以 JSON-LD datePosted 筛当天。
- Cisco 使用 Phenom widgets，每页最多 500 条；结果并非按发布日期排序，需要遍历列表后筛当天，仅下载当天的详情。Lenovo 按官网发布日期字段排序并按实际 10 条翻页。
- Brivo 使用 Pinpoint 的 postings.json 读取完整描述、职责和要求；公开列表缺发布日期，按无日期规则处理。潞晨读取官网静态岗位数据，不执行远端 JavaScript。
- 修复 SPA 链接去重：Moka #/job/{id} 和快手 #/campus/job-info/{id} 保留岗位标识，避免不同职位被错误合并。
- 未接通项保持禁用并显示原因。HTTP 403/429 不表示公司永远不可访问；可在来源页重新验证。仅邮箱或 LinkedIn 公司页的来源，需先出现可公开读取的完整职位列表才能接通。

## 可核对的入口证据

- [DeepSeek 官方人才页](https://talent.deepseek.com/) 指向当前 high-flyer Moka board；[Kimi 官方人才页](https://careers.kimi.com/) 指向 Moonshot board。
- [摩尔线程](https://www.mthreads.com/jobs)、[并行科技](https://www.paratera.com/)、[壁仞](https://www.birentech.com/join/)、[天数智芯](https://www.iluvatar.com/join-us)、[沐曦](https://www.metax-tech.com/join.html)、[BAAI](https://www.baai.ac.cn/about/joinus) 的公开官网指向对应招聘入口。
- [第四范式招聘公告](https://www.gaoxiaojob.com/announcement/detail/40037.html) 提供更新后的 Moka site；[燧原招聘帖](https://www.nowcoder.com/feed/main/detail/a0befd209c27400e9694d3240219e320) 提供当前投递入口，其公司官网本身仍可能返回 403。

## 重跑

```powershell
node scripts/update-expanded-registry.mjs
npm run test:adapters
npm run verify:expanded
node scripts/report-expanded-sources.mjs
```

验证脚本会导入默认来源并逐一调用本地验证 API，不触发同步。原有来源 ID、职位、申请和简历保留。完整机器结果在忽略提交的 outputs/expanded-worker-verification.json；文档中的状态是上述时间点的观测结果。
