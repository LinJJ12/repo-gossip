# GitHub拉取韧性

## Goal

GitHub API 429/瞬时失败可重试；统计不完整时对用户可见，避免静默零数据。

## Requirements

- `packages/core` 拉取路径：有限退避重试。
- 部分 `getCommit` 失败时标记不完整并向上传递或体现在温度/提示。
- 相关单测（可用 mock）。

## Acceptance Criteria

- [x] 模拟 429 后重试成功的路径有测试或可演示。
- [x] 失败耗尽时错误信息含 rate limit/权限提示，而非空小报装成功。

## Depends

可与限流并行；不阻塞子任务 1。
