# 首页筛选设置与新增来源

首页 AI 筛选状态区新增「粗筛条件与 AI Prompt」，展开后可保存以下内容：

- 是否在粗筛排除资深/管理岗位、明确位于中美以外的岗位、明确非技术岗位。
- 是否要求相关技术线索、实习/应届/初级线索。
- 必备经验最低年数上限：默认 2，留空表示粗筛不限制；优先经验不按必备条件处理。
- 必须包含的关键词（任意一个）、排除关键词（任意一个）、额外技术关键词。标题和 JD 按文字匹配，不区分大小写，不执行正则。
- 完整的岗位判断 prompt。可恢复默认草稿，点击保存才生效。

关闭粗筛条件表示把判断交给 AI，AI 仍会按照 prompt 判断。结构化输出的分类代码、实习/应届/初级、中美工作地点、原文依据和 US Sponsorship 校验保持一致。若希望放宽某条判断，需要同时检查粗筛条件和 prompt 中是否都已调整。

## 生效与存储

设置保存在本地 D1/SQLite 的 `screening_settings` 单例记录，不放在浏览器或 `.env`。数据库迁移为 `drizzle/0010_fearless_inertia.sql`，现有职位、申请、简历、每日额度和使用量保留。

每次同步开始读取一份设置快照，用于本轮粗筛、候选排队和 AI 请求。进行中的同步继续使用原快照；保存从下一次同步或队列审核生效。保存不会立即重审或删除已有职位，也不改变每日额度和已用次数。失败待审候选可在下次审核时按新设置重试。

prompt 或粗筛条件变化会进入筛选缓存及候选内容标识，避免复用另一套设置下的接受/拒绝结果。相同设置重复保存不会仅因版本号变化重做 AI 判断；默认设置保留原缓存兼容性。页面使用版本号保护，多窗口旧版本保存返回 409，原草稿保留，可点击「重新加载已保存设置」。折叠再展开也保留未保存草稿。

API：`GET /api/ai/screening` 返回 `settings` 和 `defaults`；`PATCH /api/ai/screening` 接受 `{coarse,aiPrompt,version}`。prompt 上限 16000 字符；每组关键词最多 50 个，每个最多 80 字符。

## 本轮来源实测

以下结果在 2026-11-18 的本地 Worker 验证；数字是日期窗口之后、AI 筛选之前的候选数。0 条表示接口正常但本轮没有当天候选。

| 来源 | 状态 | 候选数 | 招聘入口 |
|---|---|---:|---|
| BOSS 直聘自身校招 | 可解析 | 50 | [官方校园招聘](https://www.zhipin.com/campus/pc/) |
| BOSS 直聘平台搜索 | 暂不可自动解析 | 0 | [平台搜索](https://www.zhipin.com/web/geek/job) |
| 快手 | 可解析，复用现有校园/实习来源 | 0 | [官方校园招聘](https://campus.kuaishou.cn/recruit/campus/e/) |
| Twitch | 可解析 | 0 | [Greenhouse](https://job-boards.greenhouse.io/twitch) |
| Stripe | 可解析 | 3 | [Greenhouse](https://job-boards.greenhouse.io/stripe) |
| Figma | 可解析 | 2 | [Greenhouse](https://job-boards.greenhouse.io/figma) |
| Notion | 可解析 | 0 | [Ashby](https://jobs.ashbyhq.com/notion) |
| Discord | 可解析 | 0 | [Greenhouse](https://job-boards.greenhouse.io/discord) |
| Reddit | 可解析 | 0 | [Greenhouse](https://job-boards.greenhouse.io/reddit) |
| Datadog | 可解析 | 0 | [Greenhouse](https://job-boards.greenhouse.io/datadog) |
| Dropbox | 可解析 | 0 | [Greenhouse](https://job-boards.greenhouse.io/dropbox) |
| GitLab | 可解析 | 0 | [Greenhouse](https://job-boards.greenhouse.io/gitlab) |
| Duolingo | 可解析 | 0 | [Greenhouse](https://job-boards.greenhouse.io/duolingo) |
| Jane Street | 可解析 | 0 | [Greenhouse](https://job-boards.greenhouse.io/janestreet) |

BOSS 公司自身的校招 API 不需要登录或安全令牌，返回完整 JD 和动态的应届/实习标签，当前没有可靠发布日期，所以只取首 50 条。更新日期和截止日期不冒充发布日期；薪酬字段单位未核实，不展示猜测单位。

BOSS 平台搜索的普通公开接口返回业务 code 37「环境异常」，公开列表跳转安全验证页，因此作为单独来源保留并禁用，不将空页面当作成功。快手校园及实习两个项目继续可用；社会招聘的匿名接口失败，暂未接通社招。

额外 10 家公司覆盖软件、开发工具、云监控、数据和量化方向，均复用公开 Greenhouse/Ashby 协议。Dropbox 营销招聘页曾返回 403，已改用可公开读取完整 JD 的官方 Greenhouse board。[Twitch 官网](https://careers.twitch.com/en/careers/)直接嵌入其 Greenhouse board；[Notion 官网](https://www.notion.com/careers)指向上述 Ashby 入口。

## 验证

```powershell
npm run test:adapters
node scripts/test-screening-settings.mjs
node scripts/update-expanded-registry.mjs --screening
node scripts/verify-expanded-sources.mjs --screening
```

111 项单元/回归测试通过，包含自定义规则、prompt 缓存隔离、版本冲突和 BOSS 日期处理。真实浏览器验证保存、折叠草稿、刷新恢复、恢复默认、手机布局和原有目录跳转。测试使用模拟模型，不增加真实模型调用；本地浏览器测试结束恢复原来的筛选设置。
