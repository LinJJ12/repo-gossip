# Design — 生产硬化与浏览器插件

## Architecture boundaries

```
Chrome extension (content + options + background)
        │  POST /api/gossip + optional BYOK headers
        ▼
api/gossip (Vercel) ── authorize? ── rate-limit/cache ── runGossip({ env: byok∪server })
        ▲
apps/web (same contract; local Vite middleware mirrors headers)
apps/bot / webhooks (optional Authorization: Bearer WEBHOOK_SECRET)
```

- **core**：保持纯引擎；BYOK 只通过已有 `GossipOptions.env` 注入，不在 core 感知「来自扩展」。
- **api**：鉴权策略、CORS、限流、缓存、密钥红线（不 log）。
- **extension**：新包建议 `apps/extension`（MV3）；不进 web bundle。

## Public vs internal auth

| 调用方 | 鉴权 |
|--------|------|
| Web / 扩展（公开） | 无需 `WEBHOOK_SECRET`；必须过限流 |
| Bot / 自动化 | 可选或要求 `Authorization: Bearer WEBHOOK_SECRET`（内部通道，可绕过更严的匿名配额或享更高配额——实现时在子任务 3 写清） |

生产不再「无 SECRET 则 500/拒绝所有浏览器」；改为「无 SECRET 时公开路径开放 + 限流」。

## BYOK header contract

建议（实现时可微调，但跨 Web/扩展/文档保持一致）：

| Header | Maps to |
|--------|---------|
| `x-github-token` | `GITHUB_TOKEN` |
| `x-llm-api-key` | `LLM_API_KEY` |
| `x-llm-base-url` | `LLM_BASE_URL` |
| `x-llm-model` | `LLM_MODEL` |

优先级：请求 BYOK > 服务端 `process.env`。`offline: true` 仍跳过 LLM。

安全：响应与日志不得回显这些头；错误信息截断，避免把 Key 拼进 `llmError`。

## CORS

扩展 / 外域 Web 需要：

- `Access-Control-Allow-Origin`：至少反射合法 Origin 或配置 `GOSSIP_CORS_ORIGINS`（含扩展 id 较麻烦——MV3 常用 background `fetch` 可免 CORS；**推荐 background service worker 发请求**，content script 只发消息）。
- `OPTIONS` preflight 处理上述 BYOK 头。

## Rate limit & cache（子任务 3）

- 键：`ip` + 规范化 `owner/repo` + `days` + `offline` +「是否 BYOK」（有用户 LLM Key 时缓存键应隔离，避免串结果）。
- 存储：先 **进程内存**（Vercel 单实例尽力而为）；文档标明多实例弱一致。后续可换 KV。
- 默认量级（可配置 env）：如每 IP 每小时 N 次；同 repo 缓存 TTL 5–15 分钟。

## GitHub resilience（子任务 4）

- 对 403/429：有限次退避重试；耗尽则抛明确错误。
- `getCommit` 失败：保留 list 元数据但在分析结果或 API 响应中标记 `statsIncomplete`（或等价），UI 提示。

## Extension UX

- Content script：仓库页（路径 `/owner/repo`）注入按钮。
- 点击 → runtime message → background POST → 结果页/侧栏/面板展示 markdown 或结构化 tabloid。
- Options：D3 字段存 `chrome.storage.local`（同步可选后置）。

## Compatibility

- CLI / Bot：行为不变；Bot 增加 `days`/offline 参数。
- README / architecture：更新公开 API、BYOK、插件加载方式（`chrome://extensions` 开发者模式）。

## Trade-offs

| 选择 | 取舍 |
|------|------|
| 公开无密钥 | 易用 vs 必须限流 |
| BYOK 过服务端 | 实现快 vs 信任托管方 |
| 内存限流/缓存 | 零依赖 vs 多实例不准 |
| background fetch | 免 CORS 头疼 vs 扩展结构稍复杂 |

## Rollback

各子任务独立；公开鉴权变更若出问题可临时设 `GOSSIP_REQUIRE_WEBHOOK_SECRET=1` 开关恢复旧行为（建议在子任务 1 实现）。
