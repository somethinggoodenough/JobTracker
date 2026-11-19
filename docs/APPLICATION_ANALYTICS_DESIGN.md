# 申请数据分析：重新设计

状态：待实现 · 2026-11-18

## 1. 背景与目标

现有实现（`lib/application-analytics.ts`、`app/application-analytics-panel.tsx`）是 4 个 KPI 卡片，加一张按维度分组的百分比表格。它有四个问题：

1. **简历和 JD 没有真正关联。** 简历技术栈和 JD 技术栈是分开分组的，没有回答“简历和这份 JD 的匹配程度会不会影响结果”。
2. **比率有偏差。** 刚投出去的申请和两个月前的放在同一个分母里。“一直没回音”是最常见的结局，但没有单独的状态，只会一直停在“待结果”。
3. **小样本的百分比会误导。** 一组只有 3 条申请，也会显示成“33.3%”。
4. **看完不知道该做什么。**

这次重新设计以**让图表一眼就能读懂**为原则：

- **一格代表一条申请。** 能画单条申请的地方就画单条申请（方块或点），不画汇总百分比。样本有多少，看图就知道。
- **全页面用同一套结果配色**，只需要记一次图例。
- **图表之间联动筛选**：点击某个技能、某一行或某个点，其他图表只高亮相关的申请。

本次不做：置信区间、LLM 自动总结、在岗位列表里显示匹配度、投递渠道（内推或官网）字段。这些放到第 10 节的后续事项里。

## 2. 核心概念与计算口径

所有口径都在 `lib/` 中用纯函数实现，并且必须有单元测试。

### 2.1 纳入范围

“已投递”的判定沿用现有逻辑：有 `applied_at`，或者事件记录或当前状态里出现过 `applied`、`screening`、`interview`、`offer`、`accepted`、`rejected` 中的任意一个。只收藏、没有投递的申请不进入任何图表，只在 KPI 里显示“共跟踪 N 个岗位”。

### 2.2 投递时间 `appliedAt`

按以下顺序取第一个有值的：`applications.applied_at` → `application_events` 中最早一条 `status='applied'` 的 `reached_at` → 最早一条任意事件的 `reached_at` → `applications.created_at`。

### 2.3 结果状态 `outcome`（每条申请只有一个）

按以下优先级取第一个满足的：

| outcome | 条件 | 中文 |
|---|---|---|
| `offer` | 到达过 `offer` 或 `accepted` | Offer |
| `interview` | 到达过 `interview` | 面试 |
| `screening` | 到达过 `screening` | 筛选 |
| `rejected` | 没有任何推进，但到达过 `rejected` | 被拒 |
| `withdrawn` | 没有任何推进，当前状态是 `withdrawn` | 已撤回 |
| `waiting` | 以上都不满足，且 `now - appliedAt < GHOST_DAYS` | 等待中 |
| `ghosted` | 以上都不满足，且 `now - appliedAt >= GHOST_DAYS` | 没回音 |

- `GHOST_DAYS = 21`，定义为导出常量，暂时不需要在界面上配置。
- “到达过”的判定依据是 `application_events` 加上当前 `status`，和现有 SQL 的处理方式一致。
- 推进之后又被拒的申请，`outcome` 记为它到达的最远阶段，另外设 `rejectedAfterProgress = true`，在 tooltip 里显示，比如“面试后被拒”。

### 2.4 有回复与已成熟

- **有回复**：`outcome` 是 `screening`、`interview`、`offer` 或 `rejected` 之一。
- **已成熟**：`outcome` 不是 `waiting`，也不是 `withdrawn`。
- **回复率** = 有回复数 ÷ 已成熟数。所有图表里的比率都用这个口径，**并且一律同时显示分子和分母**，比如“5/12”。
- **首次回复天数**：从 `appliedAt` 到第一条 `screening`、`interview`、`offer`、`accepted` 或 `rejected` 事件的 `reached_at` 之间的天数。只有有回复的申请才有这个值。

### 2.5 技能名称归一化

新建 `lib/tech-aliases.ts`。先做 NFKC、trim、合并空白和转小写，再查别名表，得到标准名称。显示时用标准名称。初始别名表至少包含：

`golang→Go`、`k8s→Kubernetes`、`js / javascript→JavaScript`、`ts / typescript→TypeScript`、`postgres / postgresql→PostgreSQL`、`py / python3→Python`、`c plus plus / cpp→C++`、`node / nodejs / node.js→Node.js`、`react.js / reactjs→React`、`aws / amazon web services→AWS`、`gcp / google cloud→GCP`、`pytorch / torch→PyTorch`、`tf / tensorflow→TensorFlow`。

简历技术栈和 JD 技术栈必须用同一个归一化函数处理。

### 2.6 匹配覆盖率 `coverage`

- `J` 是 JD 技能集合，来自 `ai_analysis.techStack[].name`，归一化后去重。
- `R` 是简历技能集合，来自 `resume_snapshot.tech_stack`，归一化后去重。用快照，是为了保留投递当时的简历内容。
- `coverage = |J ∩ R| / |J|`。如果 `J` 为空，或者这条申请没有选简历，`coverage = null`。
- 同时输出 `matchedSkills = J ∩ R` 和 `missingSkills = J \ R`。

### 2.7 投递时效 `applyLagDays`

指从岗位被首次发现到投递经过的天数：`appliedAt - firstSeen`。

- `firstSeen` 先取 `job_discoveries` 中 `identity = 'fingerprint:' || applications.job_key` 的 `first_seen_at`。
- 取不到时，用 `jobs.first_seen_at`，通过 `jobs.canonical_url = applications.canonical_url` 关联。
- 都取不到时为 `null`。
- 分档：`0–3 天`、`4–7 天`、`8–14 天`、`>14 天`、`未知`。

## 3. 数据接口

`GET /api/applications/analytics` 改为**返回每条申请的明细**，聚合计算移到客户端。这样前端才能画单条申请、做联动筛选。数据量在几百条以内，不需要担心性能。

```ts
// lib/application-analytics.ts
export type AnalyticsOutcome = "offer" | "interview" | "screening" | "rejected" | "withdrawn" | "waiting" | "ghosted";
export type AnalyticsItem = {
  id: number; company: string; title: string;
  appliedAt: string;                 // ISO
  outcome: AnalyticsOutcome;
  rejectedAfterProgress: boolean;
  firstResponseDays: number | null;
  coverage: number | null;           // 0..1
  jdSkills: string[]; matchedSkills: string[]; missingSkills: string[];   // 归一化后的标准名称
  resume: { id: number; name: string; version: number } | null;
  countries: ("CN" | "US")[];        // 沿用现有的 analysis.countries 加 location 正则回退
  categories: JobCategory[];
  careerLevel: CareerLevel | null;
  visa: "available" | "unavailable" | "unclear" | null;   // 只对含 US 的岗位有值，用 readAnalysis(ai_analysis, description, location)
  applyLagDays: number | null;
};
export type ApplicationAnalytics = {
  generatedAt: string; ghostDays: number;
  tracked: number;                   // 包括只收藏的
  items: AnalyticsItem[];            // 只含已投递的
};
```

- 服务端负责组装 SQL 和计算 `outcome`、`coverage` 等逐条字段。组装逻辑写成纯函数 `buildAnalyticsItem(row, now)`，方便测试时注入 `now`。
- 聚合函数单独放在 `lib/application-analytics-view.ts`，只做纯计算、不访问数据库，客户端和测试共用：`kpis(items)`、`weekly(items)`、`funnel(items)`、`skillGaps(items, limit)`、`groupRows(items, dimension)`。
- 旧的 `groups` 字段和 `summarizeApplications` 可以删除。目前只有 `application-analytics-panel.tsx` 用到它们。

## 4. 配色

整个分析页共用一套配色，定义在 `lib/application-analytics-view.ts` 里的 `OUTCOME_STYLE` 常量，不要在各个组件里分别写死。

| outcome | 填充 | 说明 |
|---|---|---|
| `offer` | `#1d4f2c` | 绿色深浅表示推进程度，越深走得越远 |
| `interview` | `#3f8a55` | |
| `screening` | `#8fc19a` | |
| `rejected` | `#c9733e` | 暖橙色，不要用暗红：暗红和深绿在红色盲视角下几乎分不出来 |
| `ghosted` | `#b8bdb4` | 中性灰 |
| `waiting` | 无填充，1px 虚线描边 `#9aa096` | 表示“还没出结果” |
| `withdrawn` | 无填充，1px 实线描边 `#cbd0c7` | 不参与回复率计算 |

- 被拒的橙色和三档绿色已经用 dataviz 色板校验脚本测过：色盲区分度通过，最差的相邻一对 ΔE 是 13.5（绿色盲）；普通视觉区分度也通过。浅绿 `#8fc19a` 和白底的对比度低于 3:1，所以**必须同时提供图例、tooltip 和表格视图**，不能只靠颜色传达信息。
- 图上的文字一律用现有的文字颜色（`#526453`、`#647060` 等），不要用结果状态色。
- 状态的排列顺序在所有图里都固定为：Offer → 面试 → 筛选 → 被拒 → 没回音 → 等待中 → 已撤回。

## 5. 页面布局（从上到下）

```
┌ 筛选条：时间范围 [全部 | 近 30 天 | 近 90 天]      [清除联动筛选 ✕] ┐
├ ① KPI 行（4 个数字卡片）                                            ┤
├ ② 每周投递节奏（堆叠柱状图）     │ ③ 漏斗（横向条形图）              ┤
├ ④ 匹配度 × 结果（散点图，全宽）                                     ┤
├ ⑤ 技能缺口（横向条形图）         │ ⑥ 分组对比（方块行）               ┤
└ 图例（全页共用一个，固定在 ② 上方）                                 ┘
```

页面宽度不足 1024px 时，所有区块改为单列排列。所有组件放在 `app/application-analytics/` 目录下，每个图一个文件，由 `app/application-analytics-panel.tsx` 组合起来。

### ① KPI 行

4 个卡片：**已投递**（注明“共跟踪 N 个岗位”）、**回复率**（大字写“17/45”，小字写“38%”，再注明“不含 X 条等待中”）、**面试**（outcome 是面试或 Offer 的数量）、**首次回复天数中位数**。存在联动筛选时，卡片显示的是筛选后的值，并在角上标“已筛选”。

### ② 每周投递节奏

- 用 Recharts（已通过 `components/ui/chart.tsx` 接入）画堆叠柱状图。x 轴是 `appliedAt` 所在的周（周一开始），显示最近 12 周；y 轴是投递数。
- 柱子内部按结果状态分段，顺序和颜色按第 4 节，段与段之间留 2px 白色间隔。
- 目的：最近几周大多是“等待中”的空心段，读者看图就能明白为什么近期回复少。
- 鼠标悬停时显示 tooltip：周起始日期，以及该周每种状态各有几条。

### ③ 漏斗

- 用 div 画横向条形图，按阶段固定顺序排列：投递 → 有回复 → 筛选及以上 → 面试及以上 → Offer。分母是全部已投递申请，条形长度和数量成正比。
- 每条右侧写数量；两层之间写流失数，比如“↓ 28”。
- 在“投递”那一行下方注明“其中 X 条仍在等待”。
- 不要画成梯形的“漏斗形状”。

### ④ 匹配度 × 结果（最重要的一张图）

- 用手写 SVG 画散点图。x 轴是 `coverage`（0–100%）；y 轴分 6 行，按状态顺序排列：Offer、面试、筛选、被拒、没回音、等待中（已撤回的不画）。
- 每条申请一个点，直径 8px，颜色按 outcome。同一行里重叠的点做纵向的蜂群排布或抖动错开，点外加 2px 白色描边。
- x 轴在 30% 和 60% 处画两条浅色参考线。图下方写“X 条申请缺少简历或 JD 技术栈，未显示”。
- 鼠标悬停时显示：公司、岗位、覆盖率、已匹配的技能和缺少的技能。点击跳转到对应的申请记录（沿用现有申请列表的定位方式）。
- 设计意图：如果绿色的点明显集中在右边，就说明匹配度高的投递更有效。图上不加任何统计结论文字。

### ⑤ 技能缺口

- 用 div 画横向条形图。取已投递申请的 JD 技能中出现次数最多的 15 个，按出现次数从高到低排序。
- 每个技能一根条形，分成两段：**简历写了**的部分用灰色 `#b8bdb4`，**简历没写**的部分用强调色 `#c9733e`。这里只突出缺口，所以不用结果状态色。
- 条形右侧写总次数。tooltip 显示两组的回复率，比如“简历写了：5/12 有回复；没写：1/9 有回复”。
- 点击一个技能，就设为联动筛选条件：只看 JD 要求了这个技能的申请。

### ⑥ 分组对比（方块行，用来替代旧的表格）

- 上方用标签页切换分组维度：**简历版本**（默认，每行是“简历名 vN”）、**投递时效**、**职级**、**签证担保**、**岗位方向**、**国家**。
- 每个组一行：左边是组名，中间是方块，每条申请一个 10×10px 的方块，间距 2px，组内按状态顺序排列，太多时自动换行；右边写“有回复/已成熟”，比如“5/12”。
- 已成熟数小于 5 的组，右侧文字改成浅灰色，并加上“样本少”。只做弱化处理，不隐藏这一组。
- 一条申请属于多个组时（比如有多个岗位方向），每个组里各画一个方块，这和现有逻辑一致。没有标签的申请归入“未知”或“未分类”组，这一组固定放在最后。
- 投递时效的各组按时间顺序排列，不按数量排序；其他维度按组内投递数从多到少排序。
- 点击组名，把这一组设为联动筛选条件；鼠标悬停在单个方块上时，显示和 ④ 一样的 tooltip。

## 6. 交互

- **联动筛选**：同一时间只有一个筛选条件，类型是技能、分组的某一行或单条申请之一。设置之后，所有图里不匹配的申请都降到 25% 不透明度，KPI 改为按筛选后的数据计算。再次点击同一个条件，或点击“清除”按钮，即可取消筛选。
- **时间范围**按 `appliedAt` 过滤，作用于所有图表。
- 所有图表都要有“以表格查看”的切换，表格列出这张图背后的数据，以满足无障碍要求。
- 每个方块和散点都要加 `aria-label`，比如“Example · Backend Engineer · 面试 · 覆盖率 62%”。
- 记住用户上次选的分组维度，用 `localStorage` 保存，读写都包在 try/catch 里。

## 7. 国际化

所有界面文字都要经过 `useLanguage().t()`，新增的中文文案要同时在 `lib/ui-language.ts` 里补上英文。删除旧表格以后，不再使用的翻译条目也一并清理。

## 8. 测试

扩展 `tests/application-analytics.test.mjs`。这个文件已经包含 `package.json` 的 `test:adapters`，测试数据库用的是内存 SQLite 加 drizzle 迁移。至少覆盖以下情况：

1. 7 种 `outcome` 的判定，包括推进后被拒（`rejectedAfterProgress`），以及以注入的 `now` 为基准，正好处在 `GHOST_DAYS` 边界上的申请。
2. `appliedAt` 的 4 级回退。
3. 别名归一化后的 `coverage`、`matchedSkills` 和 `missingSkills`，比如 JD 写 `golang`、简历写 `Go`，要算作匹配；以及 `coverage = null` 的两种情况。
4. `applyLagDays` 分别通过 `job_discoveries` 取值、回退到 `jobs` 取值，以及取不到时为 `null`。
5. 各聚合函数：回复率的分母不含 `waiting` 和 `withdrawn`；周的划分从周一开始；漏斗各层数量单调不增；`skillGaps` 的排序和两段计数；`groupRows` 中多标签申请的计数和“未知”组的位置。

完成后需要确认 `npm run test:adapters` 和 `npm run build` 都通过。

## 9. 验收标准

- [ ] 接口返回第 3 节定义的结构，旧的 `groups` 字段已删除。
- [ ] 页面包含第 5 节的 6 个区块，配色只取自 `OUTCOME_STYLE`。
- [ ] 联动筛选在 ④⑤⑥ 之间都能用，KPI 会随筛选更新。
- [ ] 没有任何投递记录时，显示一个空状态提示，和现有文案一致；不渲染空白的坐标轴。
- [ ] 宽度 375px 时没有横向滚动条，所有区块按单列排列。
- [ ] 第 8 节列出的测试全部通过。

## 10. 后续事项（本次不做）

- 申请记录增加“投递渠道”字段（内推 / 官网 / 招聘平台），并作为 ⑥ 的一个分组维度。
- 在岗位列表中显示每个 JD 和简历库中各份简历的覆盖率，并推荐覆盖率最高的简历。
- 用 LLM 根据聚合结果生成 2–3 条结论，只在样本量足够时显示。
- 比较简历 `target_role` 和岗位 `categories`，区分对口投递和顺手投递。
