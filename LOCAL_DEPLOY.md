# 本地部署求职雷达

要求：Node.js 22.13 或更高版本，以及 npm。以下命令均在项目根目录运行。
本地运行不需要 Cloudflare 账号或 API Key。首次安装依赖和抓取职位需要联网。

## 当前电脑（依赖、构建和数据库均已准备好）

```powershell
cd C:\Users\admin\Documents\qiuzhi\job-radar
npm start -- --port 4173
```

打开 http://127.0.0.1:4173 。另开一个终端启动每小时同步：

```powershell
cd C:\Users\admin\Documents\qiuzhi\job-radar
npm run scheduler -- --port 4173
```

调度器启动 60 分钟后执行第一次同步；需要马上抓取时，点击网站的“立即同步”。
两个终端分别按 Ctrl+C 停止。关闭终端、关机或休眠会影响服务和自动同步；目前未配置开机自启。

## 新电脑或首次解压源码包

解压到一个可写目录，打开终端进入包含 package.json 的项目根目录，然后安装依赖、构建：

首次从 GitHub 克隆时，可将 `.env.example` 复制为 `.env` 并填入自己的 DeepSeek Key。已有 `.env` 请保留；仓库不包含密钥、本地数据库或申请记录。

```powershell
npm ci
npm run build
```

仅在空数据库上，依次执行以下十二条迁移。已有数据库只执行尚未应用的迁移。

```powershell
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_complete_stephen_strange.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_nostalgic_mongoose.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_third_infant_terrible.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_chunky_pyro.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0004_thin_boomerang.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0005_workable_franklin_richards.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0006_talented_sally_floyd.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0007_stale_liz_osborn.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0008_uneven_reptil.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0009_safe_darkhawk.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0010_fearless_inertia.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0011_puzzling_living_lightning.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0012_workday_cooldown.sql
```

启动服务器并保持这个终端运行：

```powershell
npm start -- --port 4173
```

另开一个终端进入项目根目录，导入 169 个来源并逐个验证：

```powershell
node scripts/import-and-verify-registry.mjs http://127.0.0.1:4173
```

脚本只启用当次实际解析出职位的来源；验证结果保存在 outputs/source-verification.md 和 outputs/source-verification.json。来源状态随网站和网络变化，不能保证每次验证结果相同。

打开网站点击“立即同步”，即可查看实时进度、当前来源、阶段、耗时和错误。

同步中可点击顶部“取消同步”（窄屏显示叉号按钮）。取消会停止本次任务的网络请求和后续抓取，保留已写入的职位及进度记录。等待“已取消”后即可重新同步；每小时计划仍会正常触发下一轮。

需要每小时同步时，在另一个终端运行：

```powershell
npm run scheduler -- --port 4173
```

## 目录与存储

- app/job-radar.tsx：前端看板及实时同步进度。
- app/application-tracker.tsx：申请列表、资料编辑和状态时间线。
- app/resume-manager.tsx、lib/resumes.ts：简历管理界面、本地数据读写与版本检查。
- app/api/：职位、来源、同步与进度 API。
- lib/crawler.ts：Greenhouse、Ashby、Lever、Workday、Workable 和通用网页适配器。
- lib/company-crawlers.ts：Amazon/AWS、Google/DeepMind、腾讯、Eightfold（Microsoft/Qualcomm）、AMD Jibe、Oracle Fusion、SmartRecruiters、Apple、Ayar Labs Paycor、VAST Data Comeet 专用逻辑。
- data/company-adapters.json：公司专用配置、当前 ATS 招聘板和允许空列表的已确认来源。
- lib/sync.ts：去重、写库、7 天清理与同步状态记录。
- data/source-registry.json：完整来源列表。
- db/schema.ts、drizzle/：数据库结构与迁移。
- scripts/local-scheduler.mjs：每小时同步进程。
- lib/job-classifier.ts：规则预筛、DeepSeek JSON 判断、原文校验、并发限制和缓存。
- lib/job-review.ts：已有职位重新筛选。
- .wrangler/state/：本地 D1（SQLite）数据库，包含职位、来源、运行进度、申请记录、筛选缓存和 token 用量。

源码包不包含 node_modules、构建产物、现有数据库、环境变量或密钥。
如需迁移现有职位数据，先停止服务器和调度器，再单独备份并复制 .wrangler/state/ 到新项目相同位置；不要对复制过来的数据库重新应用已执行过的迁移。

有日期时只抓纽约时间当天发布的职位；日期缺失或只有更新时间时，每个来源取前 50 条，标注“发布日期未知”，按首次发现时间保留 7 天。前 50 条按网站返回顺序，不保证是最新发布；未知日期不计入今日发布。重复抓取不延长期限。升级旧副本时只补执行未应用的迁移。

左侧目录包含全部职位（7 天）、申请职位状态、简历管理、招聘来源和同步记录，窄屏使用顶部目录。职位列表每页 50 条，支持翻页、页码跳转和跨页搜索。旧 `/today` 地址跳转到 `/applications`。

首页可按雇主所属国家筛选中国公司或美国公司，并与工作地点及关键词叠加。雇主名称、别名和公司来源名称的归类在 `data/company-countries.json` 中维护。未归类的雇主可在「全部公司」中查找。

## 简历管理

打开 `/resumes` 或左侧“简历管理”，为每个版本填写名称、目标岗位（为哪个岗位准备）、简短说明、创建时间和匹配的技术栈。技术栈用逗号分隔，自动去重；可选保存纯文本简历正文。支持查看、编辑、按元信息搜索、每页 12 份翻页，以及确认后删除。创建时间按纽约时区填写和显示，以 UTC 存储。

简历独立保存在本地 SQLite 的 `resumes` 表，不受职位 7 天清理影响，不调用 DeepSeek。修改和删除会检查版本号，其他窗口已修改时提示刷新。备份请包含 `.wrangler/state/`；本地简历数据和正文不会提交 Git。申请页面中的简历文字说明仍独立保存。

新建/编辑简历中的“上传 PDF”支持每份简历一个最大 10 MB 的文件。选中后可在保存前预览，点击“保存简历及 PDF”后与资料一起保存。已保存文件可以在编辑页预览或新窗口查看、下载、替换、移除；简历卡片也提供 PDF 查看入口。取消编辑不会替换原文件，移除需保存后生效，删除简历会同时删除附件。浏览器不支持内嵌显示时可新窗口查看或下载。

PDF 通过本地模拟 R2（绑定 `BUCKET`）保存到 `.wrangler/state/v3/r2/`，元信息与引用保存在 SQLite；不会发送给 DeepSeek 或第三方服务。本地无需 Cloudflare 账号。备份和迁移时需停服务，并完整复制 `.wrangler/state/`，只复制 SQLite 文件不包含 PDF。本轮未实现 LaTeX 编译；本机未安装编译器，现有 Worker 后端需要单独接入编译服务。

已经应用 `0006` 的旧数据库升级时，停止服务器和调度器、备份数据库，重新构建后依次执行上面新增的 `0007_stale_liz_osborn.sql` 和 `0008_uneven_reptil.sql`，再启动服务及调度器。`0007` 只新增简历表与索引，保留已有数据。`npm run test:resumes` 验证本地接口和桌面/手机页面，只创建并清理带唯一名称的测试简历，不调用模型。

已经应用 `0007` 的数据库增加 PDF 功能时，停止服务器和调度器、备份数据库并重新构建，只补执行 `0008_uneven_reptil.sql`，再启动网站和调度器。`0008` 只增加三个可空的附件字段，已有简历无需修改。更早版本按顺序补齐未应用的迁移。`npm run test:resumes` 也会验证 PDF 上传、预览入口、下载、字节范围、取消替换、保存替换和移除。

## 申请职位状态

在全部职位卡片右上角点击「＋」，会创建申请记录并打开资料面板。“申请使用的简历”可从简历管理中选择，支持按名称、目标岗位、技术栈搜索和每页 12 份翻页；新建简历后可点刷新列表，不必关闭申请面板。“简历补充说明”继续保留原有文字，也可以填写额外说明。填写申请邮箱、申请时间、当前状态及达到状态的时间，然后点击“保存申请资料”。已添加的职位显示勾号，点击可继续编辑。

申请保存所选简历 ID、名称、版本、目标岗位、创建时间、技术栈及 PDF 文件名的元信息快照；不会额外复制正文或 PDF 文件。简历库之后重命名、修改或删除，不会改写已保存的申请信息。选择尚未保存的旧版本会提示刷新后重新选择；只修改申请状态或邮箱时继续保留原版本。取消选择并保存会解除关联，补充说明继续保留。申请列表显示所选名称和版本。PDF 可在简历管理查看。

升级已应用 `0008` 的本地数据库时，停止网站与调度器、备份数据库，重新构建后只补执行上面的 `0009_safe_darkhawk.sql`，再启动服务和调度器。迁移仅新增两个可空字段，旧申请和简历数据保留。更早副本需按顺序补齐所有未应用的迁移。

本次首页粗筛条件和 AI prompt 编辑还需补执行 `0010_fearless_inertia.sql`。若已有 `0009`，只执行 `0010`；它新增独立的 `screening_settings` 表，不更改现有职位、申请、简历和每日额度。首页展开「粗筛条件与 AI Prompt」保存，下一次同步或队列审核生效。

抓取优化需要 `0011_puzzling_living_lightning.sql`。本地启动会为内置招聘来源启动独立抓取进程，详情缓存位于 `.wrangler/state/crawl-details.sqlite`。列表每轮仍检查纽约当天或前 50 条无日期岗位。有更新标识的详情在标识变化时重新下载，最长缓存 12 小时。其余详情缓存 2 小时。自定义来源仍走现有应用进程。

可在本地 `.env` 设置以下参数，重启后生效。默认每个主机最多 3 个并发请求，部分共享 ATS 最多 5 个，Eightfold PCSX 每主机串行。

| 参数 | 默认值 | 可选范围 |
| --- | ---: | --- |
| `JOB_RADAR_SOURCE_CONCURRENCY` | 6 | 1–12 个来源，启用本地抓取进程时最多 6 个 |
| `JOB_RADAR_HTTP_CONCURRENCY` | 12 | 1–24 个并发抓取请求 |
| `JOB_RADAR_AI_CONCURRENCY` | 3 | 1–4 个并发审核 |
| `JOB_RADAR_SOURCE_TIMEOUT_SECONDS` | 180 | 1–600 秒 |
| `JOB_RADAR_RUN_TIMEOUT_SECONDS` | 2700 | 1–3600 秒 |

同步进度显示列表、详情、缓存命中、本地处理耗时、最后请求路径和最大响应体积。抓取超过 120 秒标记为「响应慢」。本地抓取进程每 5 秒接受一次健康检查，连续 3 次失败自动重启。本轮用于诊断的堆内存峰值来自定时采样。

Workday 限速需要 `0012_workday_cooldown.sql`。Workday 整组使用单个执行槽，请求至少间隔 750 毫秒。任一 Workday 请求遇到 429，当轮跳过剩余 Workday 来源，其他来源继续同步。有效的 `Retry-After` 保存到本地数据库，冷却到期后在下一轮同步重试。缺少有效等待时间时，下轮同步可以直接尝试。进度页会显示上游返回的 `Retry-After` 和最早重试时间。

本地抓取进程接单后立即发送 HTTP 响应头，抓取完成后再返回职位数据。进程暂时失联时，受影响的来源会在整轮剩余时间充足的情况下转到队尾补跑一次。

发起同步的客户端如果断开连接，服务会结束当轮并释放尚未完成的候选认领，已保存的结果可继续查看。如果同步进程直接退出，连续 45 秒没有心跳后，下一次读取同步进度或发起同步会收尾并释放认领。每小时同步由独立调度器发起。

运行 `node scripts/repro/sync-deadlines.mjs` 可在独立的本地 Wrangler 测试环境验证超时、迟到响应、抓取进程重启和断线恢复。测试使用模拟来源和临时数据库。

申请记录保存在同一个本地数据库的 `applications` 表，状态时间线保存在 `application_events` 表。申请时间和状态时间按本机时区填写、以 UTC 存储。状态变化追加一条历史；仅修正当前状态时间则更新最后一条历史。更早的历史记录继续保留，多窗口同时修改会提示冲突。

申请记录复制公司、职位、地点、来源、原始链接和完整 JD，与抓取职位的删除独立：满 7 天清理原职位或删除来源，均不会删除申请记录。申请记录仅在点击“移除跟踪”并确认后删除。重复添加根据职位指纹和规范 URL 去重。备份申请资料时请备份 `.wrangler/state/`，不在浏览器 LocalStorage 保存资料。

申请页面支持公司、职位、邮箱搜索与状态筛选，每页 50 条。集成验证命令 `npm run test:applications`（需先启动本地网站，保持同步空闲并暂停独立调度器），仅创建并清理带唯一名称的测试记录；会用本机 Chrome/Edge 验证简历选择、搜索、翻页、刷新保留、版本切换、读取失败与手机布局，不调用模型。

## DeepSeek 入库筛选

根目录 `.env` 使用 `deepseekapi=你的密钥`（兼容 `DEEPSEEK_API_KEY`），可选 `DEEPSEEK_MODEL=deepseek-flash`。保留现有文件即可，不需要重复创建密钥。`npm start` 使用绝对路径让 Wrangler 从根目录读取 `.env`，密钥仅作为后端本地 secret 绑定；不复制到构建产物、不提交 Git、不传给前端。修改密钥后需要重启服务。没有密钥时也能查看已通过的职位和申请记录，但未筛选的新职位不会入库。

岗位相关性采用宽松纳入：原有工程分类之外，新增 Quant Development、Data Science / Analytics、Solutions Architect、Forward Deployed、Software Engineering、Related Technical Roles。量化、数据科学/技术分析、技术方案/售前、客户部署、实施集成、前端/移动端/测试开发及技术相邻职责均可考虑，不要求相关职责是工作主体。粗筛也同步放宽，不在调用模型前提前排除这些岗位。

仍需属于 Internship / New Grad / Junior，并明确在中国或美国工作。Junior 按明确初级/入门级或最低必需经验为 0–2 年判断；最低 3 年以上、明确 Senior/Staff/Lead/管理级别继续排除。通用头衔不足以证明初级；全球远程未注明中美或只提到美国总部不作为工作国家证据。多地点岗位至少须有明确中美工作选项。

美国 JD 明确支持当前岗位就业签证赞助时，卡片标注“US Sponsorship · 明确提供签证赞助”，详情和申请保存的 JD 详情展示原文。模型提取会再核对原句，已有通过职位也可从保存的 JD 免费补标；没有标注不等于不赞助。OPT/CPT、历史 H-1B、可能考虑、海外岗位赞助和不提供赞助不会标成明确支持。赞助不是入库必需条件。

此版本不需数据库迁移，也不会隐藏已有合格职位。旧的拒绝缓存不复用，旧的合法通过缓存继续可用。之后重新抓到的岗位按新范围筛选，仍共享既有日期规则、每日可配置 AI 额度和 7 天清理。`npm run test:screening` 在同步空闲、独立调度器暂停时验证新分类、签证赞助卡片、JD 原文和手机端，自动清理合成数据，不调用模型。

流程：身份去重 → 缓存检查 → 规则排除资深、境外、无 JD、明确无关或缺少初级信号的岗位 → 保存候选快照 → 按每日额度调用 DeepSeek → 校验结果与引文 → 通过后写入正式 `jobs`。JD 页显示技术栈、赞助标注及原文依据。输出无效最多做一次纠正请求，持续错误在候选队列延迟一小时再重试。API 故障不会作为业务拒绝缓存。

首页“每日 AI 筛选额度”可以自行设置每日上限、设为 0 暂停，或选择“不设上限”，点击“保存额度”即可生效。通常一个岗位需要一次请求，重试、纠正请求也计数。设置保存在本地 SQLite 的 `ai_settings`，不写入 `.env`；初始沿用 100，之后由你选择。已用次数按纽约 00:00 重置，修改上限、重启、取消重开或多窗口不会清零已用次数。预留额度时原子检查最新设置；达到上限仍继续抓取、粗筛和缓存复用，只停止新模型请求。

`npm run test:ai-settings` 验证保存、刷新、手机端、暂停和不限模式，会恢复测试前的额度；需要本地网站运行且同步空闲，验证期间应停止独立调度器。测试会在 AI 暂停时执行一次待审队列的本地规则/缓存检查，不会调用付费模型。

如果旧数据库尚未应用 `0006_talented_sally_floyd.sql`，升级时需先补执行该迁移，再执行 `0007`，不要重复运行已应用的迁移。`0006` 保留职位、申请记录及历史用量，并新增额度配置和粗筛统计字段。有发布日期仍只抓纽约当天；无发布日期仍每个来源最多前 50 条。

`job_candidates` 是待审核队列，不在正式职位或搜索结果中显示。有发布日期的候选只在纽约发布当天交给 AI；过日仍未审核的候选会跳过，不占用新一天额度。无发布日期的候选来自每个来源前 50 条，可继续排队，但最多按首次发现保留 7 天。已审核通过的正式职位仍保留 7 天，申请记录和 JD 快照不受影响。额度有限时不能保证所有合格职位都能当天完成；严格预筛也可能漏掉未明确标注初级要求的职位。`job_discoveries` 仅保留身份散列和首次发现时间，防止未知日期职位被反复重抓而续期。

首次升级时，已有职位在重新筛选前隐藏；点击“筛选已有职位”只处理旧记录，“立即同步”则先筛旧记录再抓当天新职位。进度会显示“AI 筛选”及已处理数量，也支持取消。拒绝的旧职位删除，申请记录和 JD 快照保留，新申请会同时保存分类快照。筛选前的数据库备份在 `outputs/before-ai-filter-*.sqlite`，请按私有数据保管。

`job_evaluations` 保存内容 SHA-256、模型、精简结论和技术引文，30 天过期；不保存被拒职位的完整原文、标题、URL 等字段。同内容每小时复用结果，不重复调用；JD、标题、地点、级别相关元数据、模型或规则版本改变后重新判断。`ai_usage` 只保存模型和 token 用量，不保存密钥或提示词。默认最多 4 个模型请求并行，内存仅保留正在进行的请求。首次旧数据筛选按条计费，之后只对新/变更内容计费。

首页显示当天额度、待审核数、本月请求次数及美元费用范围，以官方账单为准。价格计算按 2026-11-17 官方 Flash 每百万 token 高峰输入未缓存 $0.30、缓存 $0.006、输出 $1.20；低峰为一半。若每次 3,000 输入、300 输出 token，不计缓存，每日 100 次、30 天约 $1.89–3.78；这是典型 token 假设，不是金额硬上限，长 JD 或输出更长时费用会变化。官方价格：https://api-docs.deepseek.com/quick_start/pricing 。

```powershell
npm run test:adapters
npm run test:navigation
node scripts/review-existing-jobs.mjs http://127.0.0.1:4173
```

导航测试调用已安装的 Chrome/Edge 无界面浏览器并使用独立临时配置；如自动识别失败可指定 `CHROME_PATH`。旧职位筛选脚本会产生真实模型费用，结果写到 `outputs/ai-review-result.json`。

## 修改代码后

先停止本地服务器，再运行 npm run build，完成后重新运行 npm start -- --port 4173。
仅改代码不需要重建数据库；新增数据库结构时按顺序应用新增迁移。

## 公司专用适配验证

Simplify / GitHub CS 职位列表的接入验证（先启动本地网站，保持同步空闲并暂停独立调度器）：

```powershell
npm run verify:community
```

会添加并验证 Simplify/Pitt CSC 实习及 Simplify/Coder Quad New Grad 两个来源，只读取公开列表和 JD，不调用模型；验证可用后启用，实际职位由后续手动/每小时同步筛选后入库。无需数据库迁移。来源中的原始申请链接参与跨站去重；列表收录时间不当作公司发布日期，缺乏可信日期时每源只取前 50 条，按首次发现保留 7 天。报告位于 `outputs/community-source-verification.json`；详情受限会明确说明，全部失败的来源不会启用。

```powershell
npm run test:adapters
node scripts/verify-runtime-adapters.mjs http://127.0.0.1:4173
```

真实验证可能持续数分钟；会访问官方公开职位数据并更新来源启用状态。部分完成会明确记录警告；HTTP 403/429 或未确认的空招聘板不算完整接通。
