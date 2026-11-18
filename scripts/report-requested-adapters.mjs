import fs from 'node:fs';
const runtime=JSON.parse(fs.readFileSync('outputs/requested-adapter-runtime.json','utf8'));
const providers=JSON.parse(fs.readFileSync('outputs/provider-adapter-verification.json','utf8'));
const scope={
 '字节跳动 Seed':'字节校招/实习入口，关键词 Seed',
 '字节跳动（火山引擎 / 豆包 / Trae / 扣子）':'字节校招/实习入口；以实际职位所属团队为准',
 '阿里巴巴（通义实验室 Qwen）':'阿里集团校招及实习批次，包含但不限于 Qwen；来源名沿用旧名称',
 '阿里云':'阿里云社会招聘入口',
 '蚂蚁集团':'社会招聘公开列表',
 '百度':'校园招聘及实习列表',
 '京东':'社会招聘公开列表；JD 在原网页内展开，申请需到官网登录',
 '小红书':'社会招聘公开列表',
 '阶跃星辰 StepFun':'Moka 校招站',
 '寒武纪':'Moka 校招站；列表无发布日期时只取前 50 条',
 '商汤科技':'飞书 edu 招聘站，以职位返回的真实招聘类型为准',
 'Dify（LangGenius）':'官方公开职位接口，申请链接为官网对应职位的申请页',
};
const reasons={
 'Apple':'本地 Worker 请求返回 HTTP 403。普通浏览器和 Node 曾取得详情，但运行时未通过，因此仍禁用。',
 'IBM':'旧搜索站为动态页面；新的 Avature 入口对直接请求返回 202 浏览器校验页，未取得稳定的职位数据。',
 'Tesla':'官网及公开职位接口返回 403；中国站接口测试返回 503。',
 '华为':'页面可打开；公开职位接口直接请求返回 403，当前未取得可验证的完整职位列表。',
 '快手':'已实现公开列表协议；浏览器可返回职位，后端匿名请求返回 code=-1“系统错误”（部分请求 400），尚未接通。',
};
const ok=runtime.sources.filter(r=>r.ok),failed=runtime.sources.filter(r=>!r.ok);
const cell=value=>String(value??'').replaceAll('|','\\|').replaceAll('\n',' ');
const row=r=>`| [${cell(r.name)}](${r.url}) | ${!r.ok?'未接通，禁用':/部分|限流|未完成/.test(r.warning||'')?'部分可用':r.empty?'可用，今天 0 条':'可用'} | ${r.ok?r.jobs:'—'} | ${(r.ms/1000).toFixed(1)} s | ${cell(scope[r.name]||(/发布日期未知/.test(r.warning||'')?'发布日期未知，最多取前 50 条':'仅保留当天发布的候选'))} |`;
const text=`# 本轮适配与本地验证结果

验证时间：${runtime.generatedAt}。本轮请求对应 31 个公司来源（字节有两个来源），其中 ${ok.length} 个在本地后端验证通过并启用，${failed.length} 个未接通并保持禁用。以下结果是一次实际验证的快照，来源页会显示后续验证状态。

**表中数量是抓取阶段的候选数，不是最终展示数。** 本次验证没有调用 DeepSeek，也没有向职位库导入或删除职位；原有 62 条已筛选职位保持不变。新候选仍需通过中美地点、目标工程岗位、实习/应届/初级及模型审核后才会显示。当天没有职位可以是成功结果。

## 五种 ATS

均支持具体公司的公开招聘板 URL。平台主页不是全站职位 feed，因此五个平台主页条目仍不作为同步来源启用。

| 平台 | 真实招聘板验证 | 结果 |
| --- | --- | --- |
${['greenhouse','ashby','lever','workday','workable'].map(adapter=>{const p=providers.find(p=>p.adapter===adapter);return `| ${adapter} | [${p?.name||adapter}](${p?.url||''}) | ${p?.ok?`协议验证通过，${p.jobs} 条${p.date?'（历史日期窗口，仅用于验证解析）':'（当天窗口）'}`:cell(p?.error||'待验证')} |`;}).join('\n')}

Workable 已增加完整 JD、requirements、benefits 和国家字段；Workday 缺少详情时会报告失败，避免全部静默丢弃。飞书、Moka、北森、Gem 和 TikTok 官网链接也可自动识别。

## 公司来源

| 来源及当前官网入口 | 本地结果 | 候选数 | 本次耗时 | 范围 / 日期规则 |
| --- | --- | ---: | ---: | --- |
${runtime.sources.slice().sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')).map(row).join('\n')}

## 当前未接通

${failed.map(r=>`- **${r.name}**：${reasons[r.name]||r.error}`).join('\n')}

Microsoft 本次抓到部分职位后遇到 429，已保留可用结果并显示“部分完成”；不能据此声称已完整覆盖所有当天职位。Apple 的直接 Node 测试结果不能代替本地 Worker 验证结果。

## 数据和运行规则

- 有可信发布日期：按纽约当天筛选；更新日期和 CMS 创建时间不会充当发布日期。
- 没有发布日期：每个来源最多取前 50 条，跨分页共同计数；按稳定的首次发现时间保留 7 天，不反复续期。
- 去重、分类缓存、候选队列、每日可配置模型额度（含重试）、7 天清理和申请记录继续生效。
- 来源 URL 的更新保留来源 ID、已存职位及申请记录。验证来源只更新连通状态，不会入库候选。
- 未保证发布日期排序的接口需要遍历列表才能找到当天职位；例如蚂蚁与小米仍有列表分页成本。详情请求已尽可能限制到当天/前 50 条未知日期候选。

## 复核

    npm run test:adapters
    node scripts/verify-requested-runtime.mjs
    node scripts/verify-provider-adapters.mjs
    node scripts/report-requested-adapters.mjs

第二条需要本地网站运行，会逐一验证并更新这批来源的启用状态，不调用模型。第三条创建的 Workday 临时验证来源会在结束时删除。
`;
fs.mkdirSync('docs',{recursive:true});fs.writeFileSync('docs/REQUESTED_ADAPTERS.md',text);
console.log(JSON.stringify({report:'docs/REQUESTED_ADAPTERS.md',sources:runtime.sources.length,working:ok.length,blocked:failed.map(r=>r.name)}));
