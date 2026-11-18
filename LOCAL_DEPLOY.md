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

仅在空数据库上，依次执行以下八条迁移。已有数据库不要重复执行已应用的迁移。

```powershell
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_complete_stephen_strange.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_nostalgic_mongoose.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_third_infant_terrible.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_chunky_pyro.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0004_thin_boomerang.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0005_workable_franklin_richards.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0006_talented_sally_floyd.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0007_stale_liz_osborn.sql
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

## 简历管理

打开 `/resumes` 或左侧“简历管理”，为每个版本填写名称、目标岗位（为哪个岗位准备）、简短说明、创建时间和匹配的技术栈。技术栈用逗号分隔，自动去重；可选保存纯文本简历正文。支持查看、编辑、按元信息搜索、每页 12 份翻页，以及确认后删除。创建时间按纽约时区填写和显示，以 UTC 存储。

简历独立保存在本地 SQLite 的 `resumes` 表，不受职位 7 天清理影响，不调用 DeepSeek。修改和删除会检查版本号，其他窗口已修改时提示刷新。备份请包含 `.wrangler/state/`；本地简历数据和正文不会提交 Git。申请页面中的简历文字说明仍独立保存。

已经应用 `0006` 的旧数据库升级时，停止服务器和调度器、备份数据库，重新构建后只执行上面新增的 `0007_stale_liz_osborn.sql`，再启动服务及调度器。此迁移只新增简历表与索引，保留已有数据。`npm run test:resumes` 验证本地接口和桌面/手机页面，只创建并清理带唯一名称的测试简历，不调用模型。

## 申请职位状态

在全部职位卡片右上角点击「＋」，会创建申请记录并打开资料面板。填写简历名称、版本或链接、申请邮箱、申请时间、当前状态及达到状态的时间，然后点击“保存申请资料”。这里保存简历文字说明，不上传简历文件。已添加的职位显示勾号，点击可继续编辑。

申请记录保存在同一个本地数据库的 `applications` 表，状态时间线保存在 `application_events` 表。申请时间和状态时间按本机时区填写、以 UTC 存储。状态变化追加一条历史；仅修正当前状态时间则更新最后一条历史。更早的历史记录继续保留，多窗口同时修改会提示冲突。

申请记录复制公司、职位、地点、来源、原始链接和完整 JD，与抓取职位的删除独立：满 7 天清理原职位或删除来源，均不会删除申请记录。申请记录仅在点击“移除跟踪”并确认后删除。重复添加根据职位指纹和规范 URL 去重。备份申请资料时请备份 `.wrangler/state/`，不在浏览器 LocalStorage 保存资料。

申请页面支持公司、职位、邮箱搜索与状态筛选，每页 50 条。集成验证命令 `npm run test:applications`（需先启动本地网站），仅创建并清理带唯一名称的测试记录。

## DeepSeek 入库筛选

根目录 `.env` 使用 `deepseekapi=你的密钥`（兼容 `DEEPSEEK_API_KEY`），可选 `DEEPSEEK_MODEL=deepseek-flash`。保留现有文件即可，不需要重复创建密钥。`npm start` 使用绝对路径让 Wrangler 从根目录读取 `.env`，密钥仅作为后端本地 secret 绑定；不复制到构建产物、不提交 Git、不传给前端。修改密钥后需要重启服务。没有密钥时也能查看已通过的职位和申请记录，但未筛选的新职位不会入库。

只在三个条件同时满足时收录：属于指定的 10 类工程岗位、属于 Internship / New Grad / Junior、明确在中国或美国工作。Junior 按明确初级/入门级或最低必需经验为 0–2 年判断；最低 3 年以上、明确 Senior/Staff/Lead/管理级别、不相关岗位均拒绝。通用 Engineer 头衔、未注明国家的全球远程、仅提到公司总部在美国均不足以证明条件。多地点岗位至少须有明确中美选项。模型仍可能误判，可通过 JD 内的原文依据核对。

流程：身份去重 → 缓存检查 → 规则排除资深、境外、无 JD、非目标工程职责和缺少初级信号的岗位 → 保存候选快照 → 按每日额度调用 DeepSeek → 校验结果与引文 → 通过后写入正式 `jobs`。JD 页显示技术栈及原文依据。输出无效最多做一次纠正请求，持续错误在候选队列延迟一小时再重试。API 故障不会放宽标准，也不会缓存成业务拒绝。

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

```powershell
npm run test:adapters
node scripts/verify-runtime-adapters.mjs http://127.0.0.1:4173
```

真实验证可能持续数分钟；会访问官方公开职位数据并更新来源启用状态。部分完成会明确记录警告；HTTP 403/429 或未确认的空招聘板不算完整接通。
