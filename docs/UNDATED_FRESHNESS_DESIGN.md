# 无发布日期岗位的新增判定

状态：待实现 · 2026-11-19

## 1. 问题

对于没有发布日期的岗位，现在的做法（[lib/crawl-policy.ts](../lib/crawl-policy.ts)）是：按官网列表顺序取前 `UNKNOWN_DATE_LIMIT = 50` 条，用“首次发现时间”代替发布时间。这会产生两类误判：

1. **基线误判。** 来源第一次被抓取时，列表上原本就有的岗位全部被当作新增。
2. **挤入误判。** 列表前面有岗位下架后，原本排在第 51 名的旧岗位挤进前 50，因为我们第一次看到它，就把它当作新增。

本地数据（2026-11-19）显示：298 个岗位里有 235 个（79%）没有发布日期；它们大多是在来源第一次被抓取的当天被发现的。例如上海人工智能实验室 42/42、米哈游 21/21、Google 15/15、Amazon 6/6、寒武纪 5/5，都属于基线误判。

## 2. 目标与原则

- **新增**的判定依据是：上一次完整检查时还不存在，这一次才出现。这样就能把出现时间限定在两次检查之间。
- 判断不了的情况，标为**疑似新增**或**存量**，不能当作确认的新增。
- 能拿到真实日期的，就用真实日期。
- 尽量少抓详情：翻列表只记录 ID，只对真正新出现的岗位抓详情。
- 有日期岗位的现有逻辑保持不变。

本期不做：根据 ID 推算基线岗位的具体发布日期；借助 LinkedIn 等外部站点判断。

## 3. 新鲜度分级

`jobs` 表新增 `freshness` 字段，取值如下：

| freshness | 含义 | 是否计入「今日新增」，以及是否默认显示 |
|---|---|---|
| `published` | 官网给出了发布日期（即现有的 `publication_verified = 1`） | 发布日期在今天时计入 |
| `new` | 出现在最近一次有效快照和本次抓取之间，且这段间隔不超过 `NEW_GAP_HOURS` | 首次发现在今天时计入 |
| `uncertain` | 本次新出现，但无法确认（原因见 4.3 节） | 不计入，但默认显示，用灰色标签 |
| `baseline` | 来源第一次快照时就已存在，或者间隔太久，无法判断 | 不计入，默认隐藏 |

`jobs` 表另外新增 `appeared_after` 字段：对 `new` 和 `uncertain` 的岗位，记录上一次有效快照的时间。界面上据此显示“在 X 和 Y 之间出现”。

## 4. 机制

### 4.1 岗位 ID 账本

在 [db/schema.ts](../db/schema.ts) 中新增两张表，并生成迁移：

```
source_postings   source_id, posting_key, first_seen_at, last_seen_at, last_position, first_run_id
                  PK(source_id, posting_key)；索引 (source_id, last_seen_at)
source_snapshots  id, source_id, run_id, crawled_at, observed_count, scan_complete(0|1),
                  status(success|partial|failed)
                  索引 (source_id, crawled_at)
```

- `posting_key` 等于归一化后的 `externalId`，规则和 [lib/job-storage.ts](../lib/job-storage.ts) 中 `sourceKey` 的 `normalize(job.externalId || url)` 一致。
- `source_postings` 中 `last_seen_at` 早于 90 天的行，在每轮同步开始时清理。保留 90 天，是为了让下架后又重新挂出的旧岗位不会被当成新增。

### 4.2 抓取时观察整张列表

新建 `lib/posting-ledger.ts`，用 AsyncLocalStorage 提供一个当前来源的账本上下文：

```ts
type LedgerContext = {
  known: Set<string>;          // 本来源 source_postings 里所有的 posting_key
  hasSnapshot: boolean;        // 是否存在 status=success 的历史快照
  observed: { key: string; position: number }[];  // 本轮观察到的岗位，按列表顺序
  scanComplete: boolean;       // 是否自然翻到了列表末尾
};
```

修改 `createPostingSelection()`：

- 方法签名从 `accept(date)` 改为 `accept(date, id?)`。所有调用处都要传入岗位 ID，可以用 `grep "accept("` 找到它们，目前大约有 60 处。
- **每一行都要记录到 `observed`**，不论有没有日期，也不论最后是否被接受。
- 有日期的行，判断规则保持不变。
- 无日期的行：
  - 如果没有账本上下文，或者没传 `id`：沿用现有逻辑（取前 50 条），并在警告里写明“无法追踪新增”。
  - 如果 `hasSnapshot = false`（这是基线轮）：沿用前 50 条的规则。这些岗位入库时会被标为 `baseline`。
  - 如果 `hasSnapshot = true`：**只接受 `known` 中不存在的 ID**，最多 50 条。已知的 ID 不再抓取详情。
- 修改 `stop(dates)`：无日期的列表要继续往后翻，直到满足下面任意一个条件：已观察 `ID_SCAN_LIMIT = 300` 行；已翻 `ID_SCAN_PAGES = 20` 页；或者列表已经到底。只有到底时才设 `scanComplete = true`。有日期列表的停止条件保持不变。
- 适配器在自然翻到最后一页时，要调用 `ledger.complete()`。不确定是否到底的情况，就不要调用。

### 4.3 判定规则（纯函数）

`classifyFreshness(input)` 放在 `lib/posting-ledger.ts` 里，不访问数据库：

```
输入：key, position, dateKind?, date?, known, prev（本来源最近一次 status=success 的快照，可为空）,
     now, firstSeenElsewhere（job_discoveries 中跨来源最早的发现时间，可为空）
```

按以下顺序判断，取第一个满足的条件：

1. `dateKind = "published"`，并且日期有效 → `published`（沿用现有的有日期逻辑）。
2. `dateKind = "updated"`，并且日期早于 7 天前 → **丢弃**，不入库。原因是更新时间一定晚于或等于发布时间，更新时间已经很旧，说明这一定是旧岗位。
3. `dateKind = "listed"`（聚合站点的收录日期）：日期早于 7 天前 → `baseline`；在 `NEW_GAP_HOURS` 以内 → `new`，`appeared_after` 取收录日期；其他情况 → `uncertain`。
4. `key` 已经在 `known` 中 → 这不是新出现的岗位，沿用该岗位已有的 freshness。
5. `prev` 为空 → `baseline`。
6. `firstSeenElsewhere` 早于 `now - NEW_GAP_HOURS` → `uncertain`。说明同一个岗位已经在其他来源出现过很久了。
7. `position` ≥ `prev.observed_count`，并且 `prev.scan_complete = 0` → `uncertain`。说明它在上次扫描的范围之外，可能早就存在了。
8. `now - prev.crawled_at` 超过 7 天 → `baseline`。
9. `now - prev.crawled_at` 超过 `NEW_GAP_HOURS` → `uncertain`。
10. 以上都不满足 → `new`，`appeared_after = prev.crawled_at`。

常量：`NEW_GAP_HOURS = 36`，`ID_SCAN_LIMIT = 300`，`ID_SCAN_PAGES = 20`。都在 `lib/posting-ledger.ts` 中导出。

### 4.4 数据流

**Worker 抓取路径**（[lib/crawl-execution.ts](../lib/crawl-execution.ts)）：

1. 开始抓取前，从 D1 读取这个来源的 `known` 集合和 `prev` 快照。
2. 用 `ledger.run(context, ...)` 包住 `crawlSource`，抓取过程在账本上下文里执行。

**本地抓取进程路径**（[lib/local-crawl-client.ts](../lib/local-crawl-client.ts)、[scripts/local-crawler.mjs](../scripts/local-crawler.mjs)）：

1. 由 Worker 读取 `known` 和 `hasSnapshot`，放进 `/crawl` 的请求体里发给本地进程。
2. 本地进程把 `observed` 和 `scanComplete` 放进返回结果里。
3. 本地进程现在限制请求体不超过 25000 字符，这个上限要提高到 1 MB。

**在 Worker 里写入**（[lib/sync.ts](../lib/sync.ts) 的 `syncSource`）：

1. 抓取结束后，先用 `classifyFreshness` 算出每个岗位的 `freshness` 和 `appeared_after`，作为新字段传进 `upsertJobs` 的 Entry。**注意：判定依据必须是本轮写入之前的 `known` 和 `prev`。**
2. 然后在同一个写入队列里依次执行两步：把 `observed` upsert 到 `source_postings`（新行写 `first_seen_at`，所有行更新 `last_seen_at` 和 `last_position`）；再插入一条 `source_snapshots` 记录，`status` 跟随这个来源的最终状态。
3. 来源失败或被取消时，不写 `source_postings`，快照的 `status` 记为 `failed`。失败的快照不会成为下一轮的 `prev`。
4. `partial`（部分完成）的快照同样不能作为 `prev`。

**在 `persistJobs` 中处理 freshness**：

- 新入库的岗位，使用 Entry 传入的 `freshness`。
- 已有岗位更新时，只能升级为更可靠的级别，不能降级。可靠程度从高到低依次为 `published`、`new`、`uncertain`、`baseline`。`published` 永远优先。
- `posted_at` 的规则保持不变：无日期的岗位仍然用 `firstSeen`。这样 7 天的保留期也保持不变。

### 4.5 补充真实日期（逐个排查适配器）

在 [lib/job-types.ts](../lib/job-types.ts) 的 `JobRecord` 中新增 `dateKind?: "published" | "updated" | "listed"`。没有这个字段，但有 `postedAt` 时，视为 `published`。

需要排查的适配器：用 `grep "postedAt: null\|accept(null)"` 查找，目前包括 `dify`、`gem`、`netease`、`tiktok`、`bossCampus`、`eightfoldLegacy`、`luchentech`、`pinpoint`、`shlab`、`mihoyo` 和 Simplify。每个适配器检查四处：

1. 列表接口里有没有没被使用的 `publishTime`、`createTime`、`updateTime` 一类字段；
2. 详情页的 JSON-LD 里有没有 `datePosted`；
3. 如果有 sitemap，看它的 `lastmod`；
4. 详情接口的返回字段。

确认含义之后，分别填入 `postedAt` 和对应的 `dateKind`。如果无法确认字段是发布日期还是更新日期，就按 `updated` 处理。

排查结果写进 `docs/UNDATED_ADAPTER_AUDIT.md`，每个适配器一行：字段名、示例值、判定的 dateKind，以及判断依据。

- **Simplify**：`date_posted` 是聚合站点的收录日期，用 `dateKind = "listed"` 传入。对应代码中“不能当作雇主原始发布时间”的注释保留，现在用 `listed` 这个类型来正确表达它的含义。

## 5. 回填现有数据

在迁移之后，同步开始时用一次性脚本回填：

1. `publication_verified = 1` 的岗位：`freshness = 'published'`。
2. 其余无日期的岗位：如果它的 `first_seen_at` 和所在来源最早的 `first_seen_at` 是同一个纽约日，记为 `baseline`；否则记为 `uncertain`，因为事后已经无法验证。
3. 用现有岗位的 `externalId` 预填 `source_postings`，但**不要预填快照**。这样每个来源上线后的第一轮都是基线轮，从第二轮开始才能判定新增。这一点要写进发布说明。

## 6. 界面与查询

- [lib/job-query.ts](../lib/job-query.ts) 和 [app/api/jobs/route.ts](../app/api/jobs/route.ts)：
  - `new_today` 改为两部分之和：`published` 中 `posted_at` 在今天的，加上 `new` 中 `first_seen_at` 在今天的。
  - 岗位列表新增筛选参数 `freshness`，默认值为 `published,new,uncertain`，也就是不显示 `baseline`。
- 岗位卡片上的标签：
  - `published`：显示「今日发布」或具体日期，沿用现有样式。
  - `new`：显示「新出现」，tooltip 写“在 <appeared_after> 与 <first_seen_at> 之间出现”。
  - `uncertain`：显示灰色的「疑似新增」，tooltip 写明原因：间隔较长、超出上次扫描范围，或者在其他来源出现得更早。为此，`classifyFreshness` 要同时返回一个 `reason` 码，存到 `jobs.freshness_reason` 字段。
  - `baseline`：显示「存量」。
- 筛选栏增加一个「包含存量」开关。
- 删除 [lib/crawler.ts](../lib/crawler.ts) 里现有的“发布日期未知：本轮最多取前 50 条……”警告，改为记录扫描情况：“已扫描 N 条（完整 / 截断）、新出现 M 条”。这些数字写进 `metrics_json`。
- 所有新文案都要经过 `t()`，并在 [lib/ui-language.ts](../lib/ui-language.ts) 中补上英文。

## 7. 测试

新增 `tests/posting-freshness.test.mjs`，并加入 `test:adapters`：

1. `classifyFreshness`：4.3 节的 10 条规则各写至少一个用例，并测试规则之间的优先级。例如：已经在 `known` 中的岗位，即使带有 `listed` 日期，也按第 3 条规则处理。
2. 选择器：
   - 基线轮接受前 50 条；
   - 非基线轮只接受未知的 ID；
   - 翻到 300 行或 20 页时停止，并且 `scanComplete = false`；
   - 调用 `complete()` 后，`scanComplete = true`；
   - 没有账本上下文时，行为和改动前完全一致。
3. 挤入场景：快照 A 的前 60 名是 1–60；快照 B 中，第 1–5 名下架，原来的 51–55 进入了前 50。判定结果应该是没有任何新增。
4. 写入：
   - freshness 只升级不降级；
   - 来源失败时不写 `source_postings`；
   - `partial` 和 `failed` 的快照不会成为 `prev`。
5. 回填脚本：用现有的测试数据跑一遍，检查结果符合第 5 节的三条规则。
6. 本地进程：请求体达到 1 MB 时能被正常接收，返回结果中包含 `observed`。

验收时，还要在本地用真实来源连续跑 3 轮：

- 第 1 轮，新增的无日期岗位为 0，全部是 `baseline`；
- 第 2、3 轮，新出现的数量应该和官网的实际变化一致：随机抽 5 个人工核对；
- 上海人工智能实验室、米哈游、Google 这几个来源，在第 2 轮不应该再出现整批新增。

## 8. 后续事项（不在本设计范围内）

- **递增 ID**：如果某个适配器的数字 ID 经过确认是递增的，就在适配器注册表里标出来。新出现的 ID 如果比基线前 20 名中最小的 ID 还小，降级为 `uncertain`。
- **列表排序**：对确认按“新到旧”排序的列表，新出现的岗位如果排在第 20 名以后，降级为 `uncertain`。
- **从其他来源借日期**：同一个岗位的去重指纹如果在 Simplify 中出现过，就借用它的 `listed` 日期，作为公司官网来源的参考。
