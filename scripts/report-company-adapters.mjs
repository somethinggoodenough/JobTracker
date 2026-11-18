import fs from 'node:fs';
const base=process.argv[2]||'http://127.0.0.1:4173';
const registry=JSON.parse(fs.readFileSync('data/source-registry.json','utf8'));
const profiles=JSON.parse(fs.readFileSync('data/company-adapters.json','utf8'));
const audit=JSON.parse(fs.readFileSync('outputs/company-adapter-audit.json','utf8'));
const previous=JSON.parse(fs.readFileSync('outputs/source-verification.json','utf8'));
const runtime=JSON.parse(fs.readFileSync('outputs/company-adapter-runtime.json','utf8'));
const live=(await(await fetch(`${base}/api/sources`)).json()).sources;
const latest=(await(await fetch(`${base}/api/sync/progress`)).json()).run;
const escape=v=>String(v??'').replaceAll('|','\\|').replaceAll('\n',' ');
const rows=registry.map(item=>{
 const profile=profiles.find(p=>p.name===item.name), checked=runtime.sources.find(s=>s.name===item.name);
 const original=previous.sources.find(s=>s.name===item.name), probed=audit.sources.find(s=>s.name===item.name);
 const current=live.find(s=>s.name===item.name);
 let status,reason;
 if(item.kind==='provider'){status='平台适配器';reason='平台本身没有单一公司职位 feed';}
 else if(checked?.ok){status=checked.empty?'接通，当前零职位':checked.partial?'部分接通':'新增实测通过';reason=checked.warning||`实际解析 ${checked.jobs} 条，数据库另按 7 天窗口过滤`;}
 else if(profile){status='已实现，验证未通过';reason=checked?.error||'等待运行时验证';}
 else if(original?.ok){status='原已接通';reason='沿用上轮已验证适配器，本轮未重复全量验证';}
 else if(probed?.status===403||probed?.status===429){status='访问受限';reason=`HTTP ${probed.status}；尚不能确认完整职位接口可用`;}
 else if(probed?.status===404){status='需确认招聘入口';reason='当前地址 HTTP 404；不能据此断言该公司无法抓取';}
 else if(probed?.ats?.some(u=>u.includes('.jobs.feishu.cn'))||/字节跳动/.test(item.name)){status='接口访问待解决';reason='招聘页/相关链接可见；已测试的飞书/字节职位查询需要请求签名，直接请求返回 405；该来源未接通';}
 else if(probed?.systems?.length||probed?.ats?.length){status='已识别线索，接口未确认';reason=`招聘系统线索：${probed.systems.join(', ')||'外部招聘链接'}；尚无完整 JD 成功验证`;}
 else{status='尚未确认可适配';reason=probed?.error||`页面状态 ${probed?.status??'未知'}；尚未确认能返回完整 JD 的公开接口，原解析器：${original?.error??'未解析'}`;}
 if(checked?.ok&&current?.last_error)reason+=`；最近一次同步警告/错误：${current.last_error}`;
 return {name:item.name,kind:item.kind,status,adapter:profile?.adapter||current?.adapter||original?.adapter||'auto',enabled:!!current?.enabled,url:profile?.url||probed?.url||item.url,lastSyncError:current?.last_error||null,reason};
});
const report={generatedAt:new Date().toISOString(),registered:rows.length,companies:rows.filter(r=>r.kind==='company').length,
 enabled:live.filter(s=>s.enabled).length,newProfiles:profiles.length,
 verified:rows.filter(r=>r.status==='新增实测通过').length,empty:rows.filter(r=>r.status==='接通，当前零职位').length,
 partial:rows.filter(r=>r.status==='部分接通').length,implementedBlocked:rows.filter(r=>r.status==='已实现，验证未通过').length,
 unresolvedOriginalFailures:rows.filter(r=>r.kind!=='provider'&&r.status!=='原已接通'&&!profiles.some(p=>p.name===r.name)).length,latestSync:latest,sources:rows};
fs.writeFileSync('outputs/company-adapter-assessment.json',JSON.stringify(report,null,2));
const md=['# 公司专用适配器统计与验证','',`时间：${report.generatedAt}`,'',
 `登记 ${report.registered} 个来源，其中 ${report.companies} 家公司；当前启用 ${report.enabled} 个来源。`,
 `本轮配置 ${report.newProfiles} 家公司：新增实测通过 ${report.verified}，当前零职位 ${report.empty}，部分接通 ${report.partial}，已实现但访问/验证失败 ${report.implementedBlocked}。`,
 `原失败来源中另有 ${report.unresolvedOriginalFailures} 个尚未确认可适配，保留原状态。不能把它们归为永久不可抓取。`,'',
 '新增专用系统代码覆盖 Amazon、Google、Eightfold、Jibe、腾讯、Oracle Fusion、SmartRecruiters、Apple、Paycor、Comeet。部分公司通过修正 ATS 招聘板配置接入，复用 Greenhouse/Ashby/Workday。',
 '列表能返回 HTTP 200 不等于接通；新增通过项已在本地 Worker 中实际解析职位。零职位来源单独列出。',
 '部分 ATS 仅提供更新时间；无发布日期的来源按首次发现时间处理。探测职位数不等于 7 天窗口内实际入库数。','',
 `最近同步：${latest?.status||'无'}；扫描 ${latest?.jobs_seen??0}，新增 ${latest?.jobs_added??0}，更新 ${latest?.jobs_updated??0}，清理 ${latest?.jobs_deleted??0}。`,
 latest?.error_summary?`最近同步的实际错误：${latest.error_summary.replaceAll('\n','；')}`:'最近同步无错误记录。','',
 '| 公司/来源 | 状态 | 适配器 | 启用 | 说明 |','|---|---|---|---|---|',
 ...rows.map(r=>`| [${escape(r.name)}](${r.url}) | ${r.status} | ${r.adapter} | ${r.enabled?'是':'否'} | ${escape(r.reason)} |`),''];
fs.writeFileSync('outputs/company-adapter-assessment.md',md.join('\n'));
console.log(JSON.stringify({...report,sources:undefined},null,2));
