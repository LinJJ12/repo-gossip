# 限流与短时缓存

## Goal

公开 `/api/gossip` 具备 IP/仓库限流与短时结果缓存，控制 GitHub/LLM 成本。

## Requirements

- 超限返回 429，正文说明重试建议。
- 缓存键含 repo、days、offline、BYOK 隔离维度；TTL 可 env 配置。
- 内存实现可接受；文档注明多实例限制。
- 内部 Bearer 调用的配额策略在 design/实现注释中写清（更高或共享）。

## Acceptance Criteria

- [x] 短时间重复相同公开请求可命中缓存（可用日志或响应头 `X-Cache` 验证）。
- [x] 压测/循环请求触发 429。

## Depends

`09-07-public-api-byok` 公开契约已落地。
