# CI流水线

## Goal

PR / push 自动跑 `npm test` 与 `npm run typecheck`。

## Requirements

- 添加 `.github/workflows/ci.yml`（或等价）：install → test → typecheck。
- Node >= 18，与 `package.json` engines 一致。

## Acceptance Criteria

- [x] 工作流文件存在且本地可被 `actionlint`/目视确认步骤正确。
- [x] 文档或 README 可一句提及 CI（可选）。

## Depends

建议在公开 API 改动后合并，可与子任务 1 并行开发但合并顺序不限。
