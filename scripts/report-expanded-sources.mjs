import { readFileSync, writeFileSync } from 'node:fs';
import targets from '../data/expanded-adapter-targets.json' with { type: 'json' };
const report = JSON.parse(readFileSync('outputs/expanded-worker-verification.json', 'utf8'));
const results = targets.map(t => {
 const result = report.sources.find(s => s.name === t.name);
 if (!result) throw new Error(`Missing runtime result: ${t.name}`);
 return {...t, ...result};
});
const escape = text => String(text ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const table = rows => [
 '| 公司 | 本地实测 | 抓取候选数 | 适配器 | 说明 |', '|---|---|---:|---|---|',
 ...rows.map(r => `| [${escape(r.name)}](${r.url}) | ${r.ok ? '可解析' : '未接通'} | ${r.jobs} | ${r.adapter} | ${escape(r.ok ? r.warning || (r.jobs ? '完整 JD 可读取' : '接口正常，本轮无当天职位') : r.error)} |`), '',
];
writeFileSync('docs/EXPANDED_ADAPTERS.md', [
 '# 中国剩余来源与追加公司适配', '', `本地 Worker 实测时间：${report.generatedAt}。`, '',
 `本轮共 ${results.length} 个来源：${results.filter(r => r.ok).length} 个可解析，${results.filter(r => !r.ok).length} 个未接通。`, '',
 '计数是通过日期窗口的抓取候选数，尚未经过粗筛和 DeepSeek，不代表新增职位数。0 条且接口正常表示今天没有候选，不是解析失败。验证只更新来源健康状态和入口，不调用模型或写入职位。', '',
 '## 中国剩余 30 家', '', ...table(results.slice(0, 30)),
 '## 用户追加的 26 家', '', ...table(results.slice(30)),
 '## 接入和范围', '',
 '- Palantir 复用原有来源；Akami 按 Akamai 接入；Vast.ai 与原有 VAST Data 分开。公司名称不决定职位国家，仍由每个职位的地点和 JD 判断。',
 '- 有可靠发布日期只抓纽约当天；缺日期每个来源跨页共享 50 条名额。创建、更新、索引时间均不冒充发布日期。',
 '- 部分中国来源采用可公开读取的校园入口，覆盖校招及实习，不宣称覆盖该公司的所有社会招聘。快手同时查询当前校招与实习项目，年度项目编号配置在公司配置中。',
 '- 华为先筛选父职位，再读取岗位意向中的真实职责和要求；列表中的占位文字不能代替 JD。',
 '- SHLAB 使用服务端支持的 7 条分页；鹏城与之江调用匿名公开北森 pb API，不依赖页面挑战或私人登录。',
 '- Netflix 使用仍可用的公开 legacy 搜索 API，最多读取前 50 个无日期列表项的详情，再以 JSON-LD datePosted 筛当天。',
 '- Cisco 使用 Phenom widgets，每页最多 500 条；结果并非按发布日期排序，需要遍历列表后筛当天，仅下载当天的详情。Lenovo 按官网发布日期字段排序并按实际 10 条翻页。',
 '- Brivo 使用 Pinpoint 的 postings.json 读取完整描述、职责和要求；公开列表缺发布日期，按无日期规则处理。潞晨读取官网静态岗位数据，不执行远端 JavaScript。',
 '- 修复 SPA 链接去重：Moka #/job/{id} 和快手 #/campus/job-info/{id} 保留岗位标识，避免不同职位被错误合并。',
 '- 未接通项保持禁用并显示原因。HTTP 403/429 不表示公司永远不可访问；可在来源页重新验证。仅邮箱或 LinkedIn 公司页的来源，需先出现可公开读取的完整职位列表才能接通。', '',
 '## 可核对的入口证据', '',
 '- [DeepSeek 官方人才页](https://talent.deepseek.com/) 指向当前 high-flyer Moka board；[Kimi 官方人才页](https://careers.kimi.com/) 指向 Moonshot board。',
 '- [摩尔线程](https://www.mthreads.com/jobs)、[并行科技](https://www.paratera.com/)、[壁仞](https://www.birentech.com/join/)、[天数智芯](https://www.iluvatar.com/join-us)、[沐曦](https://www.metax-tech.com/join.html)、[BAAI](https://www.baai.ac.cn/about/joinus) 的公开官网指向对应招聘入口。',
 '- [第四范式招聘公告](https://www.gaoxiaojob.com/announcement/detail/40037.html) 提供更新后的 Moka site；[燧原招聘帖](https://www.nowcoder.com/feed/main/detail/a0befd209c27400e9694d3240219e320) 提供当前投递入口，其公司官网本身仍可能返回 403。', '',
 '## 重跑', '',
 '```powershell', 'node scripts/update-expanded-registry.mjs', 'npm run test:adapters', 'npm run verify:expanded', 'node scripts/report-expanded-sources.mjs', '```', '',
 '验证脚本会导入默认来源并逐一调用本地验证 API，不触发同步。原有来源 ID、职位、申请和简历保留。完整机器结果在忽略提交的 outputs/expanded-worker-verification.json；文档中的状态是上述时间点的观测结果。', '',
].join('\n'));
console.log('Wrote docs/EXPANDED_ADAPTERS.md');
