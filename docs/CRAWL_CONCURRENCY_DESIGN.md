# 抓取卡死：超时失效与本地抓取进程

状态：**待评审**（2026-11-19 修订）。本次修订根据本地运行记录重新判断了根因，把原方案拆成两期：第一期修复超时并补上监控，第二期的任务级调度等内容推迟，等第一期上线、观察一段时间后再决定做不做。

## 1. 现象与证据

第 58 轮同步：6 个来源一直停在「抓取中」，超过 7 分钟；另有 83 个来源排队。直到 02:58 用户手动取消，这一轮才结束。以下数据都来自本地 D1 的 `scrape_runs` 和 `scrape_source_progress` 表。

| 观察 | 说明 |
|---|---|
| 卡住的京东、华为、小米、小红书、蚂蚁集团，在第 50–57 轮的耗时都只有 12–86 秒 | 它们不是慢网站，而是在 02:41:51–02:42:10 这 20 秒里先后卡死 |
| 02:42:10 之后，这一轮没有任何新的进度写入 | 6 个执行槽是一起卡住的，说明问题出在共享的一层，不是 6 个请求各自变慢 |
| 所有历史记录里，从未出现过“单个来源抓取超过 180 秒”这条错误 | 来源级的 180 秒超时从来没有生效过 |
| 第 53 轮的 Microsoft 卡了 8390 秒；45 分钟的整轮时限也没有触发，最后是本地进程内存耗尽、被重启，这一轮才结束 | 整轮超时同样没有生效。本地进程有内存压力 |
| 20 秒的单请求超时经常出现（Meta、Palantir、阿里云等） | 时长较短的超时可以正常触发 |
| 用户取消后，6 个来源立刻结束 | 手动调用 `controller.abort()` 可以生效 |

用户取消和来源超时，都是经过同一个 `AbortSignal.any([signal, sourceTimeout])` 传给请求的（[lib/sync.ts](../lib/sync.ts)）。前者是手动 abort，后者是 `AbortSignal.timeout(180s)`。前者一直有效，后者一次都没有触发过。

## 2. 根因判断

1. **主因（待第 3 节复现确认）：workerd 里时长较长的 `AbortSignal.timeout` 没有触发。** 在 `AbortSignal.any` 里组合使用时尤其如此。社区有类似报告：fetch 配合 `AbortSignal.timeout` 时行为异常，改成手动 `setTimeout` 再 abort 就正常。Node 也有一个 issue（#57736），说包在 `AbortSignal.any` 里的超时有时不会触发。另外，[lib/job-classifier.ts](../lib/job-classifier.ts) 里的 `AbortSignal.timeout(60_000)` 是临时创建的，没有被任何变量引用，在 Node 中还可能被垃圾回收掉。
2. **诱因：本地抓取进程整体卡住。** 6 个卡住的来源都是内置来源，全部由同一个 Node 子进程执行（[scripts/local-crawler.mjs](../scripts/local-crawler.mjs)）。这个进程的堆内存上限是 512 MB，最多同时执行 12 个抓取，每个响应最多缓冲 32 MiB；第 53 轮它已经因为内存耗尽崩溃过一次。进程卡住后，它内部的 20 秒超时也无法执行。
3. **两者叠加，卡住就永远不会结束。** 本地进程卡住，同时 Worker 一侧的 180 秒和 45 分钟超时都没有触发，于是执行槽一直被占着。

原方案的前提是“慢请求占着执行槽不放”，但这次故障并不是这样：这几个来源平时都很快，卡住是因为超时机制本身失效。所以原方案的任务级调度和自动调节并发都不能解决这个问题，挪到第 6 节的第二期。

## 3. 第零步：最小复现（约 10 分钟，先做）

在 `scripts/repro/` 下建一个独立的最小 Worker，带自己的 `wrangler.toml`，用 `wrangler dev --local` 运行。再起一个 Node 服务，监听 `127.0.0.1`，收到请求后永远不响应。分别测下面 5 种写法：

| 编号 | 写法 | 超时时长 |
|---|---|---|
| A | `fetch(url, { signal: AbortSignal.timeout(t) })` | 5 s、60 s |
| B | `AbortSignal.any([new AbortController().signal, AbortSignal.timeout(t)])` | 5 s、60 s、200 s |
| C | `setTimeout(() => controller.abort(), t)` | 5 s、200 s |
| D | 写法 B，但等待期间同时有另一个 fetch 在进行 | 60 s |
| E | `Promise.race([fetch(...), deadline(t)])`，其中 `deadline` 用 `setTimeout` 实现 | 200 s |

对每一种，记录 fetch 是否在 t ± 1 s 内 reject，以及 reject 的错误类型。同样的测试在 Node 26（本地抓取进程用的运行时）里再跑一遍。

- 如果 B 失败而 C、E 正常，就证实了第 2 节的第 1 条。
- **不管复现结果如何，第 4.1 节的改动都要做。** 它不依赖运行时的具体行为，副作用很小。

## 4. 第一期：修复

### 4.1 统一的硬期限

新建 `lib/deadline.ts`：

```ts
export class DeadlineError extends Error { constructor(public label: string, public ms: number) { super(`${label}超过 ${ms / 1000} 秒`); this.name = "DeadlineError"; } }
// 不依赖 AbortSignal.timeout。到期立即 reject，不等 fn 结束。
export function withDeadline<T>(label: string, ms: number, parent: AbortSignal | undefined, fn: (signal: AbortSignal) => Promise<T>): Promise<T>
```

实现要求：

- 内部创建一个 `AbortController`。父信号 abort 时，跟着 abort 这个 controller。
- 用 `setTimeout(ms)` 计时，到期时调用 `controller.abort(new DeadlineError(...))`。
- 返回 `Promise.race([fn(signal), 到期或 abort 时立即 reject 的 promise])`。
- 在 `finally` 里清理计时器和监听器。
- 被放弃的 `fn` 的 promise 要挂上 `.catch(() => {})`，避免出现未处理的 rejection。

以下 5 处原来用 `AbortSignal.timeout` 的地方全部改用 `withDeadline`：

| 位置 | 期限 | 说明 |
|---|---|---|
| [lib/sync.ts](../lib/sync.ts) 整轮 | 45 分钟（新增环境变量 `JOB_RADAR_RUN_TIMEOUT_SECONDS`，上限 3600） | 和用户取消的信号合并 |
| [lib/sync.ts](../lib/sync.ts) 单个来源 | `JOB_RADAR_SOURCE_TIMEOUT_SECONDS`，默认 180 s | 包住整个 `crawlForSync`，执行槽能否释放不再取决于底层请求是否退出 |
| [lib/crawler-http.ts](../lib/crawler-http.ts) 单次请求 | 20 s | 从拿到 HTTP 额度开始计时，包括读取响应体 |
| [lib/job-classifier.ts](../lib/job-classifier.ts) 模型请求 | 60 s | 顺带修复这里的信号可能被垃圾回收的问题 |
| [scripts/local-crawler.mjs](../scripts/local-crawler.mjs) 单次抓取 | Worker 传来的 `deadlineMs` 减去 5 s | 本地进程先到期，主动返回错误，不等 Worker 一侧到期 |

`withDeadline` 产生的 signal 必须通过 `withSyncSignal` 放进 AsyncLocalStorage，这样 `fetchSource`、`syncDelay` 和 `mapDetails` 读到的都是它。

来源到期后的处理：在 `catch` 中识别 `DeadlineError`，把来源记为失败，错误信息写“单个来源抓取超过 180 秒，下轮重试；最后请求：<host+path>，开始于 <时间>”，然后执行槽继续去取下一个来源。

### 4.2 被放弃的抓取不能再写入

- 一个来源到期后，`syncSource` 不再等待它的结果，所以职位表和候选表不会被写入。
- 唯一可能迟到写入的是 [lib/detail-cache.ts](../lib/detail-cache.ts) 里的详情缓存。现有代码在写缓存之前已经调用了 `throwIfSyncCancelled()`，只要 4.1 节的 signal 正确放进了 AsyncLocalStorage，到期后这次检查就会抛错，缓存不会写入。需要为此加一个测试。
- 进度只由 `syncSource` 写，被放弃的抓取不会再更新进度。

本期**不引入**原方案的尝试编号和条件写入。等第二期出现任务级重试时再考虑。

### 4.3 本地抓取进程的健康检查与回收

在 [scripts/local-crawler.mjs](../scripts/local-crawler.mjs) 里：

- 新增 `GET /health` 接口，沿用现有的 Bearer 认证。返回 `{ active, heapUsedMb, heapLimitMb, eventLoopLagMs }`。事件循环延迟用 `perf_hooks.monitorEventLoopDelay` 统计，取 p99。
- 新增 `GET /status?crawlId=`，返回这次抓取当前的状态：最后一个请求的 host+path、发出时间，以及正在进行中的请求数。Worker 在 `/crawl` 请求体里带上 `crawlId`（使用 `runId:sourceId`）。
- 并发上限从 12 降到 6，与来源执行槽的数量一致。堆内存使用超过上限的 80% 时，新的 `/crawl` 请求直接返回 503；Worker 收到 503 时把这个来源记为失败，并写明“本地抓取进程内存不足”。

在 [scripts/start-local.mjs](../scripts/start-local.mjs) 里：

- 每 5 秒请求一次 `/health`，超时设为 3 秒。连续 3 次失败，就判定进程卡死，记录日志后 `kill('SIGKILL')`。现有的 exit 监听会负责重启。
- 子进程的 `--max-old-space-size` 从 512 提高到 1024。

在 Worker 里（[lib/local-crawl-client.ts](../lib/local-crawl-client.ts)）：

- 来源到期时，先尽量请求一次 `/status?crawlId=`（超时 2 秒），把结果写进错误信息和 `metrics_json`。下次卡住时，就能直接看出卡在哪一层。
- 本地进程连接中断导致的失败，在本轮队列末尾**补跑一次**。前提是整轮剩余时间不少于来源期限。现在的错误信息写着“调度器将重试此来源”，但代码里其实没有重试，这里补上。

### 4.4 监控字段

`metrics_json` 新增以下字段，Worker 一侧和本地进程一侧都要记录：

- `lastRequest`：host+path，以及请求的开始和结束时间
- `maxResponseBytes`：本来源最大的一次响应体积
- `deadlineHit`：是否因到期而结束
- `localHealth`：到期时 `/health` 的返回结果

32 MiB 的单个响应上限暂时不改。等 `maxResponseBytes` 积累了几轮数据，再根据实际最大值决定下调多少。

进度页上，抓取中的来源要显示已用时间，超过 120 秒时标记为「响应慢」。不用新增状态值，由前端根据 `started_at` 计算即可。

## 5. 第一期验收

以下第 1–4 条都必须在 `wrangler dev --local` 下运行，因为这个问题只在 workerd 运行时里出现，Node 单元测试测不出来。需要用到可控的模拟来源：一个本地的 Node 服务，可以设置为“永远不响应”“响应很慢”或“阻塞事件循环”。

1. **来源到期。** 6 个模拟来源都永远不响应，并且忽略 abort。每个来源在 180 ± 2 秒内被记为失败，错误信息里包含最后请求的地址；其余来源能继续启动，整轮正常结束。Worker 直接抓取的路径和本地进程路径都要测。
2. **本地进程卡死。** 让模拟接口阻塞本地进程的事件循环。监督器在 20 秒内杀掉并重启进程；受影响的来源被记为失败，并在队列末尾补跑一次；整轮正常结束。
3. **整轮到期。** 把 `JOB_RADAR_RUN_TIMEOUT_SECONDS` 设为 60。整轮在 60 ± 2 秒内结束，状态为 partial 或 failed，剩余的候选保留到下一轮。
4. **迟到响应。** 某个来源到期之后，模拟服务再返回完整数据。`crawl_details`、`jobs`、`job_candidates` 以及这个来源的进度都不会被改写。
5. **真实运行。** 连续 5 轮完整同步，没有任何来源停在「抓取中」超过 190 秒，也没有任何一轮因为卡死需要手动取消。每一轮记录本地进程的堆内存峰值。

## 6. 第二期（推迟，满足条件后再做）

**启动条件**：第一期上线后，`metrics_json` 显示执行槽经常被**确实还在运行、只是很慢**的来源长时间占用，并且已经明显拖长了整轮耗时。目前看来，主要候选是 Microsoft PCSX：它对每台主机只允许 1 个并发，每个请求固定延迟 500 ms，还经常返回 429。

届时可以评估以下几项，按投入产出比排序：

1. **只针对个别慢来源做调整**（成本最低）：给 PCSX 一类来源单独设置更长的期限，或者限制分页数量，或者把它们排在队列最后执行。
2. **冷却期间让出执行槽**：来源在等待 `Retry-After` 时释放执行槽，到点后重新排队，来源的期限照常计时。
3. **列表和详情的任务级调度**（原方案第 2 节）：需要把四十多个适配器改写成“产出任务”的形式，同时改动本地进程的协议，工作量很大。只有在第 1、2 项都不够用时才考虑。
4. **自动调节并发、两个进程共享额度**（原方案第 3 节）：必须先有第 4.4 节的内存数据作为依据，确认不会再次把本地进程的内存耗尽。
5. **按错误类型区分的重试策略**（原方案第 4 节的表格）：例如 502/503/504 补试一次、401/403 不重试、单条详情 404 只跳过这一条。这一项可以独立实现，不依赖任务级调度。

**不放在本设计中**：原方案 5.2 节“没有上游版本号时，内容变化要等下一轮复现才覆盖”。它改变的是 JD 何时更新的数据规则，会让所有 JD 的更新都推迟一轮，与并发问题无关。如果需要，请另写一份数据新鲜度的设计来讨论。

## 参考

- [workerd：fetch 配合 AbortSignal.timeout 行为异常的社区讨论](https://www.answeroverflow.com/m/1140757781440368660)
- [nodejs/node#57736：AbortSignal.any 内的 timeout 未触发](https://github.com/nodejs/node/issues/57736)
- 代码：[调度](../lib/sync.ts) · [HTTP 限流](../lib/crawl-performance.ts) · [HTTP 请求](../lib/crawler-http.ts) · [本地进程](../scripts/local-crawler.mjs) · [本地监督器](../scripts/start-local.mjs) · [默认参数](../lib/sync-tuning.ts)
