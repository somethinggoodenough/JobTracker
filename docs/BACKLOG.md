# 待开发事项

- [ ] **降低 AI 筛选成本，评估腾讯混元 Hy4 Flash**
  - 增加可配置的模型供应商。现有 DeepSeek 保留为默认选项和回退模型，优先接入腾讯云 TokenHub 的 `hy4-flash`，OpenRouter 作为备选。按供应商和模型分别记录 token 用量、缓存命中、重试和估算费用。
  - 用约 100 条有人工标注的中英文 JD 做盲测，覆盖边缘相关岗位、实习与初级经验、跨国地点和签证赞助。两边关闭深度思考，使用相同的筛选条件和证据校验。对比合格岗位召回率、误标率、JSON 校验失败率、耗时和每条完成审核的成本。
  - 按常规定价核算长期成本，单独记录促销价格。效果达到预期后，再将 Hy4 Flash 用于常规审核，DeepSeek 用于判断不明确或校验失败的候选。两者计入现有每日请求额度，缓存按供应商、模型及筛选设置隔离。
  - 参考 [腾讯云混元 API 文档](https://cloud.tencent.com/document/product/1823/132252)、[TokenHub 定价](https://cloud.tencent.com/product/tokenhub)和 [DeepSeek 定价](https://api-docs.deepseek.com/quick_start/pricing/)。
