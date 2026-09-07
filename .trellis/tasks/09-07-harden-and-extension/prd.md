# 生产硬化与浏览器插件

## Goal

让 repo-gossip 在生产可稳定、可抗滥用地出报，并提供 Chrome 插件：在 GitHub 仓库页一键生成八卦小报；用户可在 Options 配置 LLM / GitHub 令牌，经服务端 BYOK 使用。

## Background

- 引擎：`runGossip` 已支持 `env` 覆盖 `GITHUB_TOKEN` / `LLM_*`（见 `packages/core/src/gossip.ts`），适合 BYOK 透传。
- 现状缺口：生产 Web 无鉴权头却要求 `WEBHOOK_SECRET`；无 CI、无限流/缓存；GitHub N+1 缺韧性；Discord serverless 501；Bot 缺 `days`/offline；测试与 lint 薄。
- 前端/扩展不能内嵌服务端 `WEBHOOK_SECRET`。

## Decisions

| ID | 决策 | 选择 |
|----|------|------|
| D1 | 插件形态 | GitHub 仓库页注入按钮（Chrome MV3） |
| D5 | 插件分发 | **开源打包/解压加载**：用户从仓库自行加载（开发者模式或打包 crx），MVP 不上 Chrome Web Store |
| D2 | 公开调用 | 无服务端密钥也可调用生成；靠限流 + 短时缓存 |
| D3 | 配置界面 | 插件 Options：API Base URL、GitHub Token、LLM Key/Base URL/Model |
| D4 | 密钥路径 | **BYOK 过服务端**：密钥仅当次请求使用，不落库；日志禁止打印密钥 |

## Child task map

| 顺序 | 目录 | 交付 |
|------|------|------|
| 1 | `09-07-public-api-byok` | 公开可调 + BYOK 头契约 + Web 可生产出报 + CORS |
| 2 | `09-07-add-ci` | PR：test + typecheck |
| 3 | `09-07-rate-limit-cache` | IP/仓库限流 + 结果短时缓存 |
| 4 | `09-07-github-resilience` | 429/重试与降级可见 |
| 5 | `09-07-deploy-bot-parity` | Vercel Web 边界、Bot `days`/offline、Discord 文档边界 |
| 6 | `09-07-tests-and-hygiene` | 测试补强、ESLint、鉴权去重 |
| 7 | `09-07-chrome-extension-mvp` | 仓库页注入 + Options BYOK + 出报 UI |

父任务不直接改产品代码；逐个 `start` 子任务。子任务 3 依赖 1 的公开契约；子任务 7 依赖 1（及理想情况下 3）。

## Requirements

- R1：无 `WEBHOOK_SECRET` 时，浏览器/插件仍可 POST 生成；带密钥的内部调用仍可用。
- R2：支持 BYOK 请求头（至少 GitHub Token、LLM API Key、可选 LLM Base URL / Model）；合并进 `runGossip({ env })`；永不记录密钥明文。
- R3：公开路径有 IP 与仓库维度限流；相同查询短时缓存。
- R4：GitHub 限流/失败有重试或明确错误，不静默「零统计」误导。
- R5：CI 在 PR 上跑 test + typecheck。
- R6：Bot 支持与 Web 对齐的 `days`/offline（或等价）；Discord webhook 未完成则文档标明仅长驻。
- R7：Chrome MV3 在 `github.com/owner/repo` 注入入口；Options 可存 D3 字段；出报走配置的 API。
- R8：无 BYOK 时走服务端默认密钥/离线模板（受 R3 约束）。

## Acceptance Criteria

- [x] AC1：生产部署下，Web 不配 Webhook 密钥也能成功出报（公开仓）。
- [x] AC2：带 BYOK 头时，服务端用请求内密钥调用 GitHub/LLM（可用无效 Key 观察错误路径）。
- [x] AC3：超限返回明确 429；缓存命中不重复打满 GitHub/LLM。
- [x] AC4：CI 绿：`npm test` 与 `npm run typecheck`（工作流已加；需 push 后看 Actions）。
- [x] AC5：插件在仓库页一键出报；Options 保存后下次请求带上 BYOK 头。
- [ ] AC6：父任务核对子任务均完成后归档（待用户确认 / commit）。

## Out of Scope

- GitLab/Gitee；完整 i18n；Chrome Web Store / Firefox 商店上架（开源 sideload / 打包扩展即可）。
- 扩展内本地跑完整 core（非 BYOK）。
- Discord Interactions Ed25519 完整实现（本轮文档边界即可）。
- 密钥服务端持久化或账号系统。
