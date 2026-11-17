# 求职雷达（Job Radar）

一个每小时聚合招聘网站、自动去重，并只保留最近 7 天职位的全栈网站。

## 系统设计

```text
Sites 每小时云任务
        │ 调用 sync_jobs MCP tool
        ▼
抓取服务 ── Greenhouse / Lever / Ashby / JSON-LD 适配器
        │ 规范化、发布日期过滤、去重
        ▼
Cloudflare D1
  ├─ sources       招聘来源与健康状态
  ├─ jobs          结构化职位与完整 JD
  └─ scrape_runs   每次同步的审计日志
        │
        ▼
Next/Vinext API ── React 职位看板
```

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

入库前也执行相同判断。来源没有发布日期时，`posted_at` 使用首次发现时间，因此最多保留首次发现后的 7 天。

## 数据存储

结构化数据全部存储在 Sites 托管的 Cloudflare D1（SQLite）中，不把职位数据放在浏览器 LocalStorage。D1 绑定名为 `DB`，schema 在 `db/schema.ts`，迁移在 `drizzle/`。

## 接口

- `GET /api/jobs`：查询最近 7 天职位、统计和最近同步。
- `GET/POST /api/sources`：读取或添加招聘来源。
- `DELETE /api/sources/:id`：删除来源及对应职位。
- `POST /api/sync`：手动执行一次完整同步。
- `GET /api/health`：检查数据库与保留策略。
- `POST /mcp`：暴露 `sync_jobs` 与 `get_job_stats` 给定时云任务。

## 支持的来源

- Greenhouse job boards
- Lever postings
- Ashby job boards
- 含 Schema.org `JobPosting` JSON-LD 的通用招聘网页

抓取前应确认目标网站的 robots.txt、服务条款和访问频率政策。对于需要登录、验证码或重度客户端渲染的网站，应新增官方 API 适配器，不应绕过访问控制。

## 本地命令

```bash
npm run db:generate
npm run build
npm run dev
```
