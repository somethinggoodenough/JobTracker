# 计划（Planner）：任务进度、下一步与经历沉淀

状态：待实现 · 2026-11-19

## 1. 目标

在求职雷达里新增一个「计划」模块，主要解决三件事：

1. **管理进度**。把目标、项目或学习方向、里程碑、任务这几层分清楚，随时能看到每条线推进到了哪里。
2. **知道下一步做什么**。每天打开页面，直接列出今天最该做的 1–3 件事，每件都写明为什么推荐它。
3. **把做事的过程沉淀下来**。随手记下做了什么、理解了什么、哪里做错了，复盘时能找出规律，也能把这些记录提炼成简历和面试材料。

第 3 点是前两点的副产品：不需要专门去整理，平时正常使用就会积累下来。

### 设计原则

- **没有 AI 也能完整使用。** 推荐排序用固定规则计算，结果可预测，也不花钱。AI 只做三件事：拆分任务、整理快速记录、写复盘总结。AI 只在用户点击时调用，生成的内容都是草稿，用户确认后才会保存。
- **填写的成本要低。** 多数字段都可以不填。记录的提示安排在“任务刚完成”这种自然的时机，不在其他时候打断用户。
- **用规则限制同时进行的事情。** 进行中的项目和任务各有一个数量上限，默认分别是 3 个和 2 个，用户可以随时修改，也可以设为不限；每个进行中的项目都必须有下一步。

### 本期不做

日历同步、Claude Code 会话导入、git 提交自动导入、多人协作、提醒推送。这些放到第 13 节的后续事项里。

## 2. 核心概念

```
目标 Goal ──▶ 项目 Project（kind：project / learning / code）──▶ 里程碑 Milestone ──▶ 任务 Task
                         │
                         ├──▶ 记录 Entry（进展 / 理解 / 踩坑 / 决策 / 数据 / 产出）
                         └──▶ 复习卡 Card（由「理解」类记录生成）
```

| 概念 | 例子 | 规则 |
|---|---|---|
| 目标 | 拿到 infra 方向 offer；搞懂训推一体 | 有优先级（1–3），每周可以设一个目标投入时长 |
| 项目 | 训推一体引擎 v0；RLHF 系统学习；某个代码仓库 | 状态为 `active`、`paused`、`done` 或 `dropped`。`active` 项目有数量上限，默认 3 个，用户可修改（见 2.1） |
| 里程碑 | 训练端和推理端打通权重同步 | 有完成标准和可选的目标日期。同一项目内按顺序排列 |
| 任务 | 测量 8 卡下 NCCL 广播耗时 | 状态为 `next`、`doing`、`blocked`、`done` 或 `dropped`。全局 `doing` 有数量上限，默认 2 个，用户可修改（见 2.1）。标题建议以动词开头，预估时间不超过 120 分钟 |

### 2.1 约束规则

规则的判定逻辑放在 `lib/planner-rules.ts` 中。两个数量上限存放在 `planner_settings` 表里（见第 3 节），用户可以随时修改。

- **进行中项目上限** `max_active_projects`：默认 3，可以设为 1–10，或者设为不限（`NULL`）。
- **进行中任务上限** `max_doing_tasks`：默认 2，可以设为 1–10，或者设为不限（`NULL`）。
- **达到上限时**：激活项目或开始任务时如果会超出上限，弹出对话框，提供三个选项：
  1. 暂停一个现有项目，或者把一个任务退回 `next`。从列表中选择。
  2. 把上限加 1，然后继续。会直接保存到设置里。
  3. 取消。
- **修改上限的入口**：「项目」标签页顶部显示“进行中 2/3 · 修改上限”，「今天」页面的进行中任务区域显示“进行中 1/2 · 修改上限”，点击即可修改。
- **调低上限时**：允许调到比当前数量更低。已经超出的项目和任务保持原状，不会被自动暂停；只是在数量降到上限以下之前，不能再激活新项目或开始新任务。界面上提示“当前 5 个，超出上限 3 个”。
- 进行中的项目可以随时切换，比如暂停 A、恢复 B。只要切换后不超过上限，就不需要任何确认。
- **停滞**：`active` 项目里，没有任何处于 `next` 或 `doing` 的任务。在「今天」页面顶部显示警告，提供「添加下一步」或「用 AI 拆分」两个按钮。
- **久未推进**：`active` 项目最近 7 天没有任何任务状态变化，也没有新记录。
- **卡住**：任务改为 `blocked` 时，必须填写 `blocked_reason`（在等什么或等谁）和 `check_back_on`（哪天回头看）。到了 `check_back_on` 那天，它会出现在「今天」页面的“回看”区域。
- **任务太大**：预估时间超过 120 分钟，或者顺延次数 `rollover_count >= 3` 时，在任务旁提示“建议拆分”。

### 2.2 日期口径

“今天”和“本周”都沿用应用现有的纽约时区，使用 `lib/crawl-window.ts` 里的 `JOB_TIME_ZONE` 和 `dayWindow`。一周从周一开始。

## 3. 数据模型

在 [db/schema.ts](../db/schema.ts) 中新增以下表，并用 `npm run db:generate` 生成迁移。所有时间都存为 ISO 字符串（UTC）；只有日期、没有时间的字段存为 `YYYY-MM-DD`，按纽约日历理解。会被编辑的表都带 `version` 字段，用来做乐观并发控制，写法和 `applications` 表一致：更新时校验 version，不一致返回 409。

```
planner_goals      id, title, why, priority(1-3), weekly_target_minutes?, status(active|archived),
                   version, created_at, updated_at
planner_projects   id, goal_id?, kind(project|learning|code), title, description, status(active|paused|done|dropped),
                   repo_path?, version, created_at, updated_at, last_activity_at
planner_milestones id, project_id, title, done_criteria, target_on?, position, status(open|done|dropped),
                   version, created_at, updated_at, done_at?
planner_tasks      id, project_id, milestone_id?, title, notes, status(next|doing|blocked|done|dropped),
                   due_on?, estimate_minutes?, actual_minutes?, blocked_reason?, check_back_on?,
                   unblocked_at?, rollover_count(0), delay_reason?, source_ref?, position,
                   version, created_at, updated_at, started_at?, done_at?
planner_entries    id, project_id?, task_id?, kind(progress|insight|mistake|decision|metric|artifact),
                   body, links(JSON string[]), skills(JSON string[]), metric(JSON {name,before?,after,unit}?),
                   cause?, resume_candidate(0|1), created_at, updated_at
planner_cards      id, entry_id?, project_id, question, answer, interval_days, due_on, last_result?,
                   created_at, updated_at
planner_days       day(PK, YYYY-MM-DD), available_minutes?, focus_task_ids(JSON number[]),
                   started_at?, closed_at?, note
planner_reviews    week(PK, 周一的 YYYY-MM-DD), completed_at?, notes(JSON)
planner_settings   id(PK, 固定为 1), max_active_projects?(默认 3, NULL=不限), max_doing_tasks?(默认 2, NULL=不限),
                   version, updated_at
```

字段说明：

- `delay_reason` 和 `cause` 只能取以下值：`underestimated`（低估工作量）、`environment`（环境问题）、`unclear`（需求不清）、`interrupted`（被打断）、`dependency`（依赖未就绪）、`other`（其他）。
- `skills` 写入前用现有的 [lib/tech-aliases.ts](../lib/tech-aliases.ts) 归一化，和申请分析共用同一张别名表。
- `source_ref` 用于第 9 节的自动生成任务，格式为 `application:<id>:interview`。它在 `(project_id, source_ref)` 上建唯一索引，保证同一条申请不会重复生成任务。
- 以下操作都会更新所在项目的 `last_activity_at`：任务状态变化、新增记录、复习卡片。
- 删除项目时，级联删除它的里程碑、任务和卡片。记录不删除，只把 `project_id` 置空，保留历史。

## 4. 「今天」的推荐规则

推荐逻辑写成纯函数 `rankToday(state, today, availableMinutes)`，放在 `lib/planner-rank.ts`，不访问数据库。输出由三部分组成：

1. **焦点**：最多 3 个任务。
2. **回看**：`check_back_on <= today` 的卡住任务。
3. **提醒**：停滞的项目、久未推进的项目，以及每个学习项目“今天到期的复习卡数量”。复习卡作为一个可勾选的条目放进焦点候选里。

### 4.1 候选范围

候选任务：状态为 `next` 或 `doing`，并且所属项目是 `active`。另外，每个有到期卡片的学习项目，生成一个虚拟候选：“复习 N 张卡片”，预估时间为 N × 2 分钟。

### 4.2 打分

每个候选的得分是以下各项之和，每一项同时生成一条推荐理由的文案：

| 因素 | 分值 | 理由文案示例 |
|---|---|---|
| 截止日期：取 `due_on` 和所属里程碑 `target_on × 0.5 权重` 中较紧的一个。剩 0 天得 100 分，1 天 80 分，2–3 天 60 分，4–7 天 30 分；已经过期得 100 分并标红 | 0–100 | 「周五截止，还剩 2 天」 |
| 当前处于 `doing` | 25 | 「进行中，继续完成」 |
| `unblocked_at` 在 2 天以内 | 20 | 「卡点昨天已解除」 |
| 属于所在项目中最靠前的未完成里程碑 | 15 | 「当前里程碑的关键任务」 |
| 所属目标多久没有进展：`min(天数, 10) × 3` | 0–30 | 「这个目标已 5 天没有进展」 |
| 目标优先级 × 5 | 5–15 | — |
| 预估时间超过今天的可用时间 | −40 | 「需要整块时间」 |
| 可用时间少于 90 分钟，且预估不超过 30 分钟 | +10 | 「适合碎片时间」 |
| 复习卡候选：每张到期卡 +3，最多 +30 | 0–30 | 「6 张卡片今天到期」 |

### 4.3 选出焦点

- 按得分从高到低选。同一个项目在焦点里最多出现 2 个。
- 得分相同时，依次按 `due_on`、`position`、`id` 排序，保证每次结果一致。
- 每个焦点条目显示得分最高的两条理由。
- 不在焦点里的候选折叠放在“其他候选”里，用户可以手动换进焦点。
- 用户确认后的焦点列表写入 `planner_days.focus_task_ids`。页面刷新后保持不变，不重新计算。

## 5. 每天的流程

### 5.1 开始一天

当天第一次打开「今天」页面、而 `planner_days` 里还没有当天的 `started_at` 时，弹出一张卡片：

- 选择今天的可用时间：1 小时、2 小时、4 小时、6 小时或更多。
- 显示推荐的焦点，用户可以替换或删除。
- 点「开始」后，写入 `started_at`、`available_minutes` 和 `focus_task_ids`。

这一步可以跳过。跳过时，按 4 小时可用时间显示推荐。

### 5.2 任务完成时

任务改为 `done` 时，弹出一个小表单，所有字段都可以不填：

- 实际用时：默认填入预估时间。
- 三个可选输入框：“学到了什么”生成 `insight` 记录，“有没有数据”生成 `metric` 记录，“有没有踩坑”生成 `mistake` 记录。
- 如果实际用时比预估多出 50% 以上，或者任务已经过了截止日期，额外显示“主要原因”单选，写入 `delay_reason`。

### 5.3 结束一天

点击「结束今天」后：

- 列出焦点里还没完成的任务，每个可以选：明天继续（`rollover_count + 1`）、退回待办、或者卡住。
- 加一个可选的“今日一句话”，写入 `planner_days.note`。
- 写入 `closed_at`。

如果当天没有点「结束今天」，第二天打开时自动按“明天继续”处理，然后再进入第二天的开始流程。

## 6. 记录与复习卡片

### 6.1 快速记录

计划页顶部常驻一个输入框，可以随时写一句话并选择所属项目（默认是最近一次活动的项目）。默认记为 `progress` 类型。旁边有一个「AI 整理」按钮，用法见第 10 节。

| 类型 | 用途 | 额外字段 |
|---|---|---|
| `progress` 进展 | 做了什么 | — |
| `insight` 理解 | 搞懂了什么、为什么是这样 | 可以一键生成复习卡 |
| `mistake` 踩坑 | 哪里错了、怎么发现的、怎么修好的 | `cause` |
| `decision` 决策 | 选了 A 而不是 B，原因是什么 | — |
| `metric` 数据 | 跑分、前后对比 | `metric` |
| `artifact` 产出 | 文档、PR、博客 | `links` 至少 1 条 |

### 6.2 复习卡片

- 在 `insight` 记录上点「做成卡片」，填写问题和答案。答案默认填入记录正文。
- 复习的间隔天数依次为 `[1, 3, 7, 14, 30, 60]`。
- 每次复习先显示问题，用户点击后再显示答案，然后选三档之一：「记得」进入下一档间隔；「模糊」保持当前间隔；「忘了」退回 1 天。复习结果写入 `due_on` 和 `last_result`。
- 复习界面放在「复习」标签页里，也可以从「今天」页面的复习卡候选直接进入。

## 7. 每周回顾

「每周回顾」标签页显示本周的回顾。本周回顾还没完成时，周五到周日在「今天」页面顶部给出提示。回顾分为以下 5 步，每一步都可以跳过：

1. **逐个检查进行中的项目**：下一步是否明确（停滞的项目必须补一个任务，或者改为暂停）；最靠前的未完成里程碑的目标日期是否还合理（可以直接修改）；这个项目是继续、暂停还是放弃。
2. **清理卡住的任务**：列出所有 `blocked` 任务，逐个决定是否解除、修改回看日期，或者放弃。
3. **时间分配**：本周每个目标的实际用时（`actual_minutes`，没填时用 `estimate_minutes`），和 `weekly_target_minutes` 对比，画成横向条形图。
4. **规律**：最近 4 周的 `delay_reason` 和 `cause` 分别出现了多少次，以及预估时间和实际时间之比的中位数。数据够多时，可以点「AI 总结」，生成 2–3 句话的建议。
5. **简历候选**：列出本周所有记录，用户勾选值得写进简历的，写入 `resume_candidate = 1`。

完成后写入 `planner_reviews.completed_at`，把各步的选择和备注写入 `notes`。

## 8. 界面

- 新增路由 `app/planner/page.tsx`，渲染 `<JobRadar view="planner" />`。在 [app/job-radar.tsx](../app/job-radar.tsx) 的 `View` 类型和导航里加上「计划」入口，图标用 lucide 的 `ListChecks`。手机上的导航目前是 `grid-cols-5`，需要改成 6 列，或者做其他调整，保证 375px 宽度下不出现横向滚动。
- 页面组件放在 `app/planner/` 目录下，每个标签页一个文件。
- 标签页：**今天**（默认）| **项目** | **记录** | **复习** | **每周回顾**。
- **今天**：顶部依次显示停滞和久未推进的提醒，然后是焦点列表（每项可以勾选完成、开始或卡住），接着是回看区域，最后是折叠起来的其他候选。
- **项目**：左边是项目列表，按 active、paused、done 分组；右边是项目详情，里程碑可以展开显示其中的任务，任务可以拖动排序，下方是这个项目的记录时间线。
- **记录**：按时间倒序显示全部记录，可以按类型、项目和技能筛选。
- 所有文案都要经过 `useLanguage().t()`，并在 [lib/ui-language.ts](../lib/ui-language.ts) 里补上对应的英文。
- 视觉风格沿用现有页面的配色和组件，比如 `icon-button`、`source-input` 和卡片样式。

## 9. 与求职模块打通（第三期）

- **面试准备任务**：申请状态变为 `interview` 时，系统里第一个 kind 为 `project`、标题为「求职」的项目里，会自动生成一个里程碑，名为「<公司> 面试准备」，其中包含 3 个任务：公司和岗位调研、相关知识复习、模拟面试一次。如果申请事件里有日期，截止日期就设为那一天；否则不设截止日期。用 `source_ref` 去重。如果「求职」项目还不存在，就在页面上提示用户创建，不要自动创建。
- **从技能缺口创建学习项目**：申请分析的技能缺口条目上加一个「创建学习项目」按钮，点击后生成一个 kind 为 `learning` 的项目，标题为「学习 <技能>」，并带一个任务：确定学习资料和第一步。
- **简历候选导出**：在「记录」标签页筛选 `resume_candidate = 1` 的记录，可以一键复制为 Markdown。第三期再把它升级为成果卡片，并接入简历库。

## 10. AI 功能（可选，DeepSeek）

AI 相关逻辑放在 `lib/planner-ai.ts`，调用 DeepSeek 时沿用 [lib/deepseek-config.ts](../lib/deepseek-config.ts) 的配置。每次调用前先执行 [lib/ai-budget.ts](../lib/ai-budget.ts) 的 `reserveModelRequest`，计入每日额度。如果没有配置 API key，或者额度已用完，对应按钮显示为不可用并给出提示，其他功能照常使用。

| 功能 | 入口 | 输入 | 输出（必须校验 JSON） |
|---|---|---|---|
| 拆分任务 | 任务或停滞项目上的「AI 拆分」 | 项目标题和描述、当前里程碑、要拆分的任务标题 | `{ tasks: { title, estimate_minutes }[] }`，3–6 项，每项不超过 120 分钟，标题以动词开头 |
| 整理记录 | 快速记录旁边的「AI 整理」 | 一段文字 | `{ kind, skills[], metric?, cause? }` |
| 周规律总结 | 每周回顾第 4 步 | **只发送聚合后的数据**，包括各原因的出现次数、预估和实际的比值，不发送记录原文 | `{ suggestions: string[] }`，2–3 条 |

- 所有输出都只作为草稿显示，用户确认后才写入数据库。
- JSON 校验不通过时，提示“AI 结果无法解析”，不会自动重试。
- 只有用户点击时才调用，没有任何后台调用。

## 11. 接口

所有接口放在 `app/api/planner/` 下，错误处理沿用 `lib/applications.ts` 里 `applicationError` 的写法：输入错误返回 400，版本冲突返回 409。

```
GET/POST           /api/planner/goals          PATCH/DELETE /api/planner/goals/[id]
GET/POST           /api/planner/projects       PATCH/DELETE /api/planner/projects/[id]
POST               /api/planner/milestones     PATCH/DELETE /api/planner/milestones/[id]
GET(?project=)/POST /api/planner/tasks         PATCH/DELETE /api/planner/tasks/[id]
GET(?kind,project,skill)/POST /api/planner/entries  PATCH/DELETE /api/planner/entries/[id]
GET(?due=today)/POST /api/planner/cards        POST /api/planner/cards/[id]/review  {result}
GET  /api/planner/today?minutes=               → rankToday 的结果，加上当天的 planner_days
POST /api/planner/day   {action:"start"|"close", ...}
GET/POST /api/planner/review?week=
POST /api/planner/ai    {action:"breakdown"|"classify"|"patterns", ...}
GET/PATCH /api/planner/settings  {max_active_projects: 1-10|null, max_doing_tasks: 1-10|null, version}
```

### 服务端必须执行的规则

前端也要做相同的提示，但以服务端校验为准：

- 激活项目或开始任务时，读取 `planner_settings` 里的当前上限。如果会超出上限，返回 409，错误信息里写明是哪个上限，以及当前数量和上限值，方便前端弹出第 2.1 节的对话框。上限为 `NULL` 时不检查。
- 修改上限时，只接受 1–10 的整数或 `NULL`，其他值返回 400。
- 任务改为 `blocked` 时，必须同时提供 `blocked_reason` 和 `check_back_on`。
- 状态变化时自动维护以下时间字段：`started_at`、`done_at`、`unblocked_at` 和 `last_activity_at`。

## 12. 分期与验收

### 第一期：任务主线

- [ ] 第 3 节的表和迁移；目标、项目、里程碑、任务的增删改查，带版本冲突控制。
- [ ] 第 2.1 节的所有约束都由服务端执行；两个数量上限可以在界面上修改或设为不限，达到上限时弹出三选一的对话框。
- [ ] 「今天」和「项目」两个标签页；第 5 节的开始一天、任务完成、结束一天三个流程。
- [ ] `rankToday` 按第 4 节实现，给定相同输入时输出完全相同。
- [ ] 不配置 DeepSeek 时，所有功能都能用。

### 第二期：记录、复习和回顾

- [ ] 快速记录和「记录」标签页；复习卡片和「复习」标签页；每周回顾的 5 步。
- [ ] 第 10 节的三个 AI 功能。

### 第三期：打通求职

- [ ] 第 9 节的三项。

### 通用要求

- 375px 宽度下没有横向滚动。
- 所有文案都有英文翻译。
- 运行 `npm run test:adapters` 和 `npm run build` 都要通过。

## 13. 测试

新增 `tests/planner.test.mjs`，并把它加入 `package.json` 的 `test:adapters`。测试写法参照 `tests/application-analytics.test.mjs`：使用内存 SQLite，跑 drizzle 迁移，通过 `loadLocalTypeScript` 加载代码。至少覆盖以下内容：

1. `rankToday`：表 4.2 中的每一项打分因素各写一个用例；同一项目在焦点中最多出现 2 个；得分相同时的排序规则；只有 60 分钟可用时间时，不推荐大任务；复习卡生成的虚拟候选。
2. 约束：在默认上限下，激活第 4 个项目返回 409，开始第 3 个进行中的任务返回 409；把上限改为 4 之后，同样的操作能成功；上限设为 `NULL` 时不再检查；把上限调到比当前数量还低时，已有的进行中项目不变，但不能再激活新项目；修改上限时传入 0 或 11 返回 400；改为 `blocked` 但缺少字段时返回 400；从 `blocked` 改为 `next` 时写入 `unblocked_at`。
3. 停滞和久未推进的判定，测试时注入 `today`。
4. 复习卡片：间隔天数按「记得」「模糊」「忘了」三档正确变化，到期日按纽约时区计算。
5. 结束一天：未完成的焦点任务正确增加 `rollover_count`；当天没有点「结束今天」时，第二天打开会自动补处理。
6. 第三期：面试状态触发生成任务时，同一条申请重复触发不会重复生成。

## 14. 后续事项（不在本设计范围内）

- 从本地 git 仓库导入提交记录，生成进展草稿（会用到 `repo_path` 字段）。
- 成果卡片：把多条记录归并成“做了什么、结果、怎么做的”格式的成果，每一条都能追溯到原始记录；按 JD 的技术栈挑选成果，生成简历。
- 同步 Google Calendar 的空闲时间，自动填写每天的可用时间。需要先在 claude.ai 的连接器设置里授权。
- 导入 Claude Code 会话摘要，作为进展记录。
