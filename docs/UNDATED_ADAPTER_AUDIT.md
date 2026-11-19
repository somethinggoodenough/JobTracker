# 无日期职位的适配器核查

表中示例来自项目测试样本或公开接口文档。某张招聘板的响应缺少日期时，按职位 ID 账本判断。页面 sitemap 的 `lastmod` 只反映页面变动，以下适配器均未把它当作雇主发布日期。

| 适配器 | 列表或详情字段及示例 | 采用的类型 | 依据 |
| --- | --- | --- | --- |
| Dify | `updated_at`、`created_at`，值存在时读取 | `updated` | CMS 时间用于判断旧数据，官方列表结构中尚未确认雇主原始发布日期。缺少可解析字段时按无日期处理。 |
| Gem | 公司详情 `JobPosting.datePosted`，例如 `2026-11-18` | `published`，仅字段存在时 | 列表 GraphQL 没请求发布日期。已有详情请求中可读取标准 JSON-LD，只有元数据描述时按无日期处理。 |
| 网易 | `publishTime` 或 `updateTime`，更新时间样例为毫秒 Unix 时间戳 | 分别为 `published`、`updated` | 分页接口已有职责和要求。测试覆盖仅返回 `updateTime` 时的行为。 |
| TikTok | `job_post_list[].id`，如 `"1"` | 无日期 | 已适配的公开列表返回完整职责和要求，样本中没有可确认的原始发布日期。 |
| BOSS 直聘公司校招 | `encryptJobId`，另有更新和结束时间字段 | 无日期 | 校招列表已提供详情正文。更新和结束信息未被当作首次发布。 |
| Eightfold Legacy | 职位详情 JSON-LD `datePosted`，例如 `2026-11-18` | `published` | 详情字段有发布日期语义。列表 `updatedTs` 用于缓存修订识别，无法替代详情证据。 |
| 潞晨科技 | 官网静态职位数组的 `key` | 无日期 | 同一数组提供职责、要求和加分项，现有公开结构中未确认发布日期字段。 |
| Pinpoint | 招聘板 `postings.json`，有 `datePosted` 时读取 | `published`，仅字段存在时 | 公布的 JSON 接口格式无需发布日期。缺少该字段时保留无日期处理。 |
| 上海人工智能实验室 | `create_time`，例如 `1795000000000` | 无日期 | 创建时间可能先于正式发布。按游标获取列表，用 `id` 比对。 |
| 米哈游 | 列表和详情的 `id`，如字符串数字 | 无日期 | 官网职位详情提供工作职责、任职要求、加分项和投递说明。公开列表和详情样本没有可验证的发布日期。 |
| Simplify | 公共清单的 `date_posted`，例如 `1690430400` | `listed` | 上游维护说明将其定义为添加到清单时的 Unix 时间。雇主 ATS 详情有可信发布日期时优先采用。 |

[JobPosting 原始发布日期定义](https://developers.google.com/search/docs/appearance/structured-data/job-posting) · [Pinpoint 职位 JSON 接口](https://developers.pinpointhq.com/docs/jobs-json-endpoint) · [Simplify 清单结构](https://github.com/SimplifyJobs/Summer2027-Internships/blob/dev/CONTRIBUTING.md)

## 本地验收

正式库连续运行第 74–76 轮。上海人工智能实验室、米哈游校招和社招分别扫描 140、225 和 300 个编号，后两轮都未见新编号。米哈游校招扫描完整，上海人工智能实验室和米哈游社招分别达到页数和编号预算。Google 保持正式库关闭，在隔离库连续两次各观察到 40 个编号，第二次没有新增编号。该窗口内没有仅凭两次快照确认的新职位，另抽取五条 Simplify 收录职位，均与公开清单的收录时间一致。
