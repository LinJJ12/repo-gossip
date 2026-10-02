# PRD: 重构去重与 API 加固

## Goal

消除 vite.config.ts 与 api/ 的 API 双胞胎实现、雷达 SVG/配色三处拷贝、REPO_RE 重复;修复 badge 无限流、500 信息泄漏、bot.start 吞错、飞书 token 无缓存;Bot 补 score/compare;补适配层测试。

## 背景

评审发现四类问题:
1. **重复实现漂移**:`apps/web/vite.config.ts` 手写了 `/api/gossip` + `/api/badge` 的第二份实现(无限流/无缓存/无鉴权/缺 format 支持);雷达 SVG 几何与 `GRADE_COLORS` 在 core(compare.ts/badge.ts)与 web(CompareView.tsx)多处手工同步;bot 平台各自拷贝 `REPO_RE`;history 纯逻辑在 web(`history.ts`)与扩展(`history-logic.js`)双胞胎。
2. **API 加固缺口**:`/api/badge` 无任何限流(缓存未命中一次 = 11-15 次 GitHub API,烧服务端 token 配额);`api/gossip.ts` 与 `api/feishu.ts` 的 500 响应把内部 `err.message` 泄漏给公开客户端;`apps/bot/src/index.ts` 的 `void bot.start()` 吞掉 Telegram 轮询失败;飞书 `getTenantToken` 每条消息取两次且无缓存。
3. **功能不对齐**:Bot(Telegram/Discord/飞书)只有八卦小报,没有验金(score)/对比(compare),与 CLI/Web/API 不对齐。
4. **文案漂移隐患**:web `ScoreView.tsx` 硬编码"各 20%",权重常量一改文案即失真;评分 rubric 魔法数字散落。

## Requirements

- R1. `/api/gossip` 与 `/api/badge` 的请求处理收敛为 **core 内一份框架无关实现**;Vercel 适配器与 Vite dev 中间件都只做协议转换,业务/限流/缓存/鉴权逻辑零拷贝。
- R2. `/api/badge` 增加限流(复用 consumeRateLimit);限流与运行时失败一律返回灰色 N/A 徽章(HTTP 200),保持「README 永不破图」承诺。
- R3. 公开端点 500 响应不再泄漏内部错误详情(返回笼统文案,详情进服务端日志)。
- R4. 雷达 SVG 与等级配色以 core 为唯一实现;web 直接复用。
- R5. history 纯逻辑单源化:以 web 版(严格校验)为规范语义,扩展经典脚本加载同一实现;扩展保持零构建步骤(MV3 内容脚本不能用 ES 模块,单源文件必须物理位于 `apps/extension/` 内)。
- R6. Bot 补齐 score / compare 命令(Telegram `/score` `/compare`、Discord 斜杠命令、飞书文本命令),并加轻量每用户限流;飞书文案与其他平台对齐为中文;飞书 tenant token 进程内缓存。
- R7. 评分 rubric 的散落魔法数字收敛为导出常量(行为零变化,由现有测试钉住);web 权重文案从 `SCORE_DIMENSION_WEIGHTS` 派生。
- R8. `bot.start()` 失败可见化;bot 平台 `REPO_RE` 收敛到 core 单一导出。

## 约束

- 公开 API 契约不变:字段、状态码、CORS、BYOK 头、`X-Cache`、`Retry-After` 语义保持(Vite dev 端补齐限流/缓存属于对齐,不是破坏)。
- 扩展保持 sideload 零构建;`history-logic.js` 保持经典脚本(IIFE → globalThis)。
- 评分数值语义零变化;现有 174 例测试全部保持通过(允许新增)。
- 业务逻辑进 core、适配层只做转换(spec 既有铁律)。

## Acceptance Criteria

- [ ] `vite.config.ts` 不再包含任何 gossip/badge 业务逻辑(仅协议转换与路径匹配)。
- [ ] `api/gossip.ts` / `api/badge/[owner]/[repo].ts` 每个 ≤ 40 行,无业务分支。
- [ ] `CompareView.tsx` 不再包含雷达几何与配色定义。
- [ ] 新增共享 handler 单测覆盖:路由、校验、限流、缓存、500 脱敏、badge 永不破图。
- [ ] Bot 三平台可执行 score/compare;每用户限流生效;Telegram 轮询失败有日志。
- [ ] `npm test`、`npm run typecheck`、`npm run web:build` 全绿。
- [ ] 三层 E2E:CLI 真实网络(score/compare)→ dev server API 全端点(含限流/缓存/错误路径/CORS)→ 浏览器 UI 全流程。

## Notes

- 范围外(明确不做):Discord Interactions Ed25519 验签、LLM 解读评分、真实分位排名、历史趋势持久化、i18n 全量补齐、依赖大版本升级。
