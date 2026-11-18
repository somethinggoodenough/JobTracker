# 求职雷达（Job Radar）

一个每小时聚合招聘网站、自动去重，并只保留最近 7 天职位的全栈网站。

## 系统设计

```text
本地每小时调度器（或 Sites 每小时云任务）
        │ 调用 /api/sync（或 sync_jobs MCP tool）
        ▼
抓取服务 ── ATS 通用适配器 + 公司专用适配器
        │ 规范化、发布日期过滤、去重、规则预筛与 DeepSeek 入库判断
        ▼
本地 SQLite / 托管 Cloudflare D1
  ├─ sources       招聘来源与健康状态
  ├─ jobs          结构化职位与完整 JD
  ├─ scrape_runs   每次同步的审计日志
  ├─ scrape_source_progress  每个来源的实时进度
  ├─ applications  申请资料与独立保存的职位快照
  ├─ application_events  申请状态时间线
  ├─ resumes       简历名称、目标岗位、创建时间、技术栈、正文与 PDF 元信息
  ├─ job_evaluations  内容指纹与 AI 筛选结果缓存
  └─ ai_usage  模型 token 用量（不含密钥或提示词）
        │
        ▼
Next/Vinext API ── React 职位看板
```

PDF 文件保存在 R2 对象存储；本地部署时由 Wrangler 写入 `.wrangler/state/v3/r2/`，无需云账号。

### 去重

1. `source_external_key`：来源 ID + ATS 的稳定职位 ID，阻止同一来源重复抓取。
2. `canonical_url`：移除 hash 和常见跟踪参数后的规范 URL，合并不同入口指向的同一职位。
3. `dedupe_key`：对公司、标题、地点、部门、雇佣类型的规范化组合做 SHA-256，合并跨网站转载。

三列都有数据库唯一索引，因此重复请求、手动同步与定时同步都是幂等的。同步还使用 30 分钟运行锁，避免两个抓取任务同时写入。

### 7 天保留规则

每次同步开始时执行：

```sql
DELETE FROM jobs WHERE posted_at <= 当前 UTC 时间 - 7 天;
```

有发布日期的职位仅抓取 `America/New_York` 时区当天 00:00 至次日 00:00 的记录，不是滚动 24 小时；夏令时切换日正确处理为 23/25 小时。每个来源另取列表顺序前 50 条缺少有效发布日期的职位，未知日期名额跨分页共享，尽量先选中再下载 JD。来源没有日期时不保证这 50 条是最近发布的职位。

日期未知或只提供更新时间的职位标注“发布日期未知”，`publication_verified=0`，使用首次发现时间计算 7 天保留期；不会假称今天发布，也不计入今日发布统计。`job_discoveries` 保存规范 URL/指纹的散列与首次发现时间，保证反复抓取不续期，清理后也不会因为原职位还在列表前 50 条而重新变成“新职位”。申请记录独立保存。

## 数据存储

本地部署的结构化数据存储在 `.wrangler/state/` 下的 SQLite 数据库，托管部署时使用 Cloudflare D1。职位数据不放在浏览器 LocalStorage。D1 绑定名为 `DB`，schema 在 `db/schema.ts`，迁移在 `drizzle/`。

点击职位卡片「＋」可创建申请记录，保存简历名称/版本/链接、邮箱、申请时间、状态及状态时间；简历字段是文字，不上传文件。公司、标题、链接和 JD 保存为快照，原职位过期或来源删除不影响记录。`applications` 使用规范 URL 和职位指纹唯一索引避免重复；`application_events` 记录状态变化，修改当前状态的时间会修正最新事件。修改使用版本号检查，防止多窗口覆盖；申请记录仅由用户主动移除。时间按本机时区显示，以 UTC 存库。

“申请资料与进度”也可以从简历库选择简历，支持搜索、翻页和刷新，保留原文字作为补充说明。申请保存 `resume_id` 和服务器生成的 `resume_snapshot`（名称、版本、目标岗位、创建时间、技术栈、PDF 文件名），不额外复制简历正文或 PDF；简历库后续修改、删除不会改写已保存的申请记录。切换简历时核验库中版本并在写入时再次检查，过期选择返回 409，已删除选择返回 400。单独编辑申请状态或邮箱时沿用已保存版本，取消选择后补充说明仍保留。申请列表显示所用名称与版本。

左侧“简历管理”（`/resumes`）支持新增、查看、编辑、搜索和删除简历，每页 12 份。每份记录包含名称、为哪个岗位准备、简短说明、创建时间、技术栈标签，以及可选的纯文本正文。时间按纽约时区填写和显示，以 UTC 存储；技术栈忽略大小写去重。独立的 `resumes` 表保存在同一个本地 SQLite 数据库中，不受职位 7 天清理影响，不调用 AI。列表不返回正文，只有打开编辑时读取；更新与删除使用版本检查，防止多窗口覆盖。申请记录中的简历文字仍可独立填写。备份简历时备份 `.wrangler/state/`，简历数据不会提交 Git。集成验证：`npm run test:resumes`（需先启动本地网站）。

新建/编辑简历可上传一个最大 10 MB 的 PDF，支持保存前预览、保存后内嵌预览、新窗口查看、下载、替换与移除。选中的文件在点击保存后才持久化，取消编辑保留原文件。元信息与文件引用在一次数据库写入中保存；每次替换使用独立对象键，版本冲突不会覆盖已保存文件。替换、移除或删除简历会清理旧 PDF。接口按扩展名、MIME、PDF 文件头和结束标记校验，并限制实际上传流大小。预览接口支持字节范围，响应禁止缓存；上传文件不会送往 AI 或第三方解析服务。备份需同时包含 `.wrangler/state/v3/d1/` 与 `.wrangler/state/v3/r2/`，建议停服务后备份整个 `.wrangler/state/`。本轮未加入 LaTeX 编译，需要另行配置编译器服务。

## 岗位筛选

职位仅在同时满足以下条件后入库和展示：指定的 10 类工程岗位、Internship / New Grad / Junior、中国或美国工作地点。明确资深、明确境外或 JD 缺失的职位先由规则排除；其余使用 DeepSeek 一次完成岗位分类、级别、地点和技术栈提取，并校验结果和原文引文。Junior 定义为明确初级/入门级或最低必需经验为 0–2 年且无资深要求；没有级别证据、国家不明或全球远程但没有明确中美选项时拒绝。模型有误判可能，JD 页保留判断依据以便核对。

入库前先做身份去重、缓存检查、目标工程职责和初级经验信号预筛。只有有实习/应届/初级或 0–2 年工作经验依据的未缓存候选，才进入 `job_candidates` 待审核队列。队列不属于正式职位列表，保存公开职位快照以便次日继续审核；到原发布日期满 7 天（未知日期按首次发现）自动过期。优先处理接近过期的候选，同一到期日优先实习/应届。`jobs.ai_policy` 标记通过版本，通过后才显示分类、级别、国家和技术栈，不符合的候选直接清理。申请记录独立保留。

首页“每日 AI 筛选额度”可填写每日请求上限、设为 0 暂停 AI，或选择“不设上限”。初始沿用 100，但不再是固定限制；设置存放在本地 SQLite 的 `ai_settings`，重启仍保留。通常一个岗位需要一次请求，HTTP 重试和 JSON 纠正请求也计数。`ai_daily_budget` 按纽约日历日期记录已用次数，修改上限不会清零，预留额度时原子读取最新设置；并发、重启、重复同步不会绕过已设置的上限。达到上限仍继续抓取、粗筛、去重和缓存复用，新候选排队待审；超过 7 天清理。无效输出最多一次纠正重试，持续错误留队并延迟重试，不作为业务拒绝缓存。

粗筛优先排除明显非目标职位、明确资深/境外/无 JD、必备条件最低 3 年以上工作经验，以及缺乏初级信号的岗位；保留仅为优先条件的经验和最低 0–2 年要求。只有筛选后的新候选才调用 DeepSeek。首页显示最近完成同步的粗筛拒绝数、缓存复用次数和实际 AI 请求数；首次更新后的同步完成才会有这组统计。粗筛是保守规则，仍可能漏掉表达不明确的职位。

抓取和排队 AI 审核都按纽约当天判断已知发布日期；有日期但已过当天的待审候选会跳过，不消耗新一天额度。无发布日期仍按每个来源前 50 条抓取，未知日期候选最多保留 7 天。已经审核通过的正式职位继续保留 7 天，申请记录不随抓取清理。

根目录 `.env` 的 `deepseekapi` / `DEEPSEEK_API_KEY` 仅在后端使用，默认模型 `deepseek-flash`、关闭思考模式、最多 4 请求并行，完成的请求及时释放内存。同内容用 SHA-256 + 规则版本 + 模型缓存 30 天；重复小时同步不重复付费，内容或规则改变后重新判断。`ai_usage` 记录真实 token 用量，页面按官方高低峰单价显示本月费用范围。详见 [本地部署文档](LOCAL_DEPLOY.md)。

## 接口

- `GET /api/jobs?page=1&q=&location=&type=&period=all&category=&level=`：只查询当前策略通过的职位，每页 50 条，返回分类、技术栈、待审核数与分页；支持分类/级别筛选、`period=today` 和跨页搜索。
- `GET /api/ai/status`：返回是否配置密钥（不返回密钥）、模型、候选队列数、纽约日期的每日额度/已用/剩余/重置时间、本月请求次数及 token 用量。
- `POST /api/sync?reviewOnly=1`：处理已有待审记录及候选队列，共享每日额度、运行锁、进度和取消功能。
- `GET /api/applications?page=1&q=&status=`：每页 50 条申请记录，支持搜索和状态筛选。
- `POST /api/applications`：传入 `{ "jobId": 123 }` 创建职位快照，重复添加返回已有记录。
- `GET/PATCH/DELETE /api/applications/:id`：读取资料与时间线、保存资料、移除记录。PATCH 传入 `resume,email,applied_at,status,status_at,version`；日期使用含时区的 ISO 时间，过期版本返回 409。
- PATCH 可额外传 `resume_id,resume_version` 选择简历库版本；传 `resume_id:null` 取消选择，省略这两项保留原选择与快照。`resume_snapshot` 为只读字段。
- `GET/POST /api/sources`：读取或添加招聘来源。
- `GET /api/resumes?page=1&q=`：搜索简历名称、目标岗位、说明与技术栈，每页 12 份，不返回正文。
- `POST /api/resumes`：创建简历，必填 `name,target_role`；可选 `summary,created_at,tech_stack,content`，日期须为含时区的 ISO 时间。
- `GET/PATCH/DELETE /api/resumes/:id`：读取完整简历、部分修改、删除。PATCH 和 DELETE 必须带 `version`；过期版本返回 409。
- `POST /api/resumes` 和 `PATCH /api/resumes/:id` 也接受 `multipart/form-data`：`data` 为原 JSON 资料字符串，`pdf` 为文件；移除附件时使用 `remove_pdf=true`，不能同时上传和移除。未传附件字段时保留原文件。
- `GET /api/resumes/:id/pdf`：内嵌读取 PDF，支持单段 `Range`；加 `?download=1` 下载。不提供公开存储键，未上传或已删除时返回 404。
- `DELETE /api/sources/:id`：删除来源及对应职位。
- `POST /api/sync`：手动执行一次完整同步。
- `GET /api/sync/progress`：读取来源阶段、耗时、计数及错误；同步长请求用 JSON 空白心跳保持连接。
- `GET /api/sync/runs?page=1`：分页读取同步历史。
- `POST /api/sync/cancel`：传入 `{ "runId": 123 }` 取消指定同步。状态依次为 `running → cancelling → cancelled`，中止网络请求及后续来源，保留已入库职位；不影响下一次每小时同步。
- `GET /api/health`：检查数据库与保留策略。
- `POST /mcp`：暴露 `sync_jobs` 与 `get_job_stats` 给定时云任务。

## 支持的来源

- Greenhouse job boards
- Lever postings
- Ashby job boards
- Workday company career sites
- Workable company career sites（含完整 JD）
- 含 Schema.org `JobPosting` JSON-LD 的通用招聘网页
- SimplifyJobs / Pitt CSC 实习与 SimplifyJobs / Coder Quad New Grad 的公开 GitHub JSON 列表

### Simplify 与 GitHub 职位列表

`lib/community-crawlers.ts` 支持 [SimplifyJobs 实习列表](https://github.com/SimplifyJobs/Summer2027-Internships) 和 [New Grad 列表](https://github.com/SimplifyJobs/New-Grad-Positions)。无需 GitHub token；从公开原始 JSON 读取在招、可见岗位，按列表收录时间排序并去重，每个来源最多取前 50 条，再访问公开 Simplify 详情取得原始 JD 和工作地点。优先保留公司原始申请链接，使官网与聚合来源沿用现有 URL/指纹去重、规则粗筛、AI 配额及 7 天保留规则。技术栈仍由现有筛选流程依据 JD 提取。

仓库 `date_posted` 是列表收录时间；Simplify 的 `start_date`、`updated_date`、`date_display` 及 JSON-LD 日期也不能保证是公司首次发布日期，均不伪装为今日发布。缺乏可信原网站日期时标为日期未知，按首次发现保留 7 天，重复抓取不续期。Simplify 详情失败时，仅尝试已支持的 Greenhouse、Lever、Workable 单岗位接口；若原网站提供可信发布日期，仍仅抓纽约当天。缺少 JD、详情受限或协议变更会明确报错/标记部分完成，不会用列表标题拼造 JD。

来源页可粘贴这两个仓库根链接、GitHub `blob/.../listings.json`、`raw.githubusercontent.com` JSON 链接，或 Simplify 的 `Top-Summer-Internships-YYYY` 列表链接。其他仓库需提供兼容 Simplify 字段的 JSON 文件；尚未支持任意 README Markdown 表格。年份变化后应更新到仍维护的实习仓库。

`npm run verify:community` 会将以上两个来源添加到本地并逐一验证，通过后启用；不调用 DeepSeek，也不写入正式职位。验证结果保存在 `outputs/community-source-verification.json`，之后正常手动或每小时同步时才进入岗位筛选。无需重新导入全部公司来源。

### 公司专用适配器

`lib/company-crawlers.ts` 实现 Amazon/AWS、Google/DeepMind、AMD Jibe/iCIMS、腾讯、Eightfold（Microsoft/Qualcomm）、Oracle Fusion、SmartRecruiters（Arista/ServiceNow/LLNL）、Apple、Ayar Labs Paycor 和 VAST Data Comeet。

`lib/additional-crawlers.ts` 新增飞书招聘、Moka、北森、Gem，以及 Meta、TikTok、Salesforce、阿里、百度、蚂蚁、美团、京东、小米、网易、小红书、快手和 Dify 的公开职位协议。具体公司覆盖范围、实际连通结果和未接通原因见 [本轮适配清单](docs/REQUESTED_ADAPTERS.md)。配置和代码存在不代表当前可用；以本地运行时验证为准。

`data/company-adapters.json` 保存公司到招聘系统的显式配置，包含修正后的招聘入口。来源必须通过运行时验证，失败项仍禁用。Microsoft 已能抓取，但分页可能返回 429；Apple 在本地 Worker 中仍返回 403。限流或后续分页失败时，Eightfold 会保留已获取的职位并明确标记“部分完成”。招聘来源页支持逐个重新验证；验证不会调用模型。

验证与统计：

```powershell
npm run test:adapters
node scripts/verify-runtime-adapters.mjs http://127.0.0.1:4173
node scripts/report-company-adapters.mjs http://127.0.0.1:4173
```

最后一条命令依赖本次调查生成的 `outputs/company-adapter-audit.json`、`outputs/source-verification.json` 和运行时验证报告；缺失时先运行相应调查脚本。

本地部署和数据路径见 [LOCAL_DEPLOY.md](LOCAL_DEPLOY.md)。当前本地数据库位于 `.wrangler/state/`，使用独立调度进程每小时触发同步；无需 Cloudflare 账号。

抓取前应确认目标网站的 robots.txt、服务条款和访问频率政策。对于需要登录、验证码或重度客户端渲染的网站，应新增官方 API 适配器，不应绕过访问控制。

## 本地命令

页面目录：`/` 全部职位、`/applications` 申请职位状态、`/resumes` 简历管理、`/sources` 招聘来源、`/runs` 同步记录。旧 `/today` 地址跳转到申请页。桌面显示左侧目录，窄屏显示顶部目录；职位列表支持前后翻页及输入页码跳转。

```bash
npm run db:generate
npm run build
npm run dev
```
