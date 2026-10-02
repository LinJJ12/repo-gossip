# Design: 重构去重与 API 加固

## 1. 共享 HTTP handler(core)

**新文件 `packages/core/src/http-api.ts`**,框架无关:

```ts
export type HttpApiRequest = {
  method: string;            // "GET" | "POST" | "OPTIONS" | ...
  url: string;               // path + query,如 "/api/gossip?repo=o/r"
  headers: HeaderBag;
  bodyText?: string;         // 原始 body(Vite 中间件流式读取后传入)
  bodyJson?: unknown;        // 预解析 body(Vercel req.body)
};
export type HttpApiResponse = { status: number; headers: Record<string, string>; body: string };
export async function handleGossipApiRequest(req: HttpApiRequest, deps?: ApiDeps): Promise<HttpApiResponse>;
export async function handleBadgeApiRequest(input: BadgeApiInput, deps?: BadgeDeps): Promise<HttpApiResponse>;
```

- 逻辑从 `api/gossip.ts` / `api/_auth.ts` / `api/badge/[owner]/[repo].ts` 平移,行为以 Vercel 版为准(它是生产语义);`deps` 注入 `runGossip/runScore/runCompare`(默认 core 实现)用于单测。
- **badge 新增限流**:IP 桶(namespace `badge-ip`,env `GOSSIP_RATE_LIMIT_BADGE_PER_HOUR`,默认 60/h);429 时仍返回 200 + 灰色 N/A SVG + `Retry-After` 头 + `X-Cache: RATE-LIMITED` + 短 `Cache-Control`,守住「永不破图」。
- **500 脱敏**:catch-all 返回 `{"error":"internal error"}`,`console.error` 记录详情。400 的校验错误(parseRepoRef/parseCompareRepos 的用户提示)保持原文。
- `isProductionRuntime()`、`clientIp()` 从 `api/_auth.ts` 移入 core;`api/_auth.ts` 删除。
- 导出经 `packages/core/src/index.ts`。

**适配器**:
- `api/gossip.ts`(~30 行):OPTIONS/方法透传,`req.body` → `bodyJson`,`req.headers` 直传,响应逐头 set + `res.send(body)`。
- `api/badge/[owner]/[repo].ts`(~30 行):从 `req.query` 取 owner/repo/lang,调用 handler。
- `apps/web/vite.config.ts`:两个插件合并为一个,匹配 `/api/gossip*` 与 `/api/badge/:owner/:repo.svg`,流式读 body(保留 64KB 上限→413),直接 `import { handleGossipApiRequest, handleBadgeApiRequest } from "../../packages/core/src/http-api.ts"`(相对 .ts 导入,vite.config 由 esbuild 打包,无需先 build core)。删除全部 ssrLoadModule 业务逻辑。

## 2. 雷达/配色单源

- `formatCompareRadarSvg` 增加 `options.ariaLabel`(web 传中文标签),`GRADE_COLORS` 已导出。
- `CompareView.tsx`:删除本地 `radarSvg`/`GRADE_COLORS`/`DIM_ORDER` 几何,`import { formatCompareRadarSvg, GRADE_COLORS } from "@repo-gossip/core"`(vite alias 已存在);图例色与表格渲染保留。

## 3. history 单源

- **单源文件 = `apps/extension/history-logic.js`**(约束:扩展内容脚本/importScripts 只能用经典脚本,文件必须在扩展目录内)。升级为 web 版严格语义:`normalizeHistoryList` 重入 `slimGossipData` 再瘦身(防存储脏数据崩渲染)、`slimGossipData` 输出补齐 markdown 回退、stars 数值化、temperature 恒有、String 强制化。扩展侧消费点(app.js/content.js/background.js)均已有可选链/默认值防御,升级为超集行为。
- web `history.ts` 变为类型门面:副作用导入该文件(`import "../../extension/history-logic.js"` + 邻接 `history-logic.d.ts` 声明 globalThis API),re-export 类型化函数;`HISTORY_KEY`、`formatSavedAt`、localStorage 存取等 web 专属部分留在门面。
- 两套既有测试(web-history / extension-panel-history)继续分别从两侧加载同一实现;语义冲突的断言按严格语义更新。

## 4. Bot 对齐

- core 导出 `LOOSE_REPO_PATTERN`(现 bot 的 REPO_RE)供平台匹配文本中的 owner/repo。
- 每用户限流:`consumeRateLimit("bot-user", userId, 12, 10min)`,超限中文提示。
- **Telegram**:`/score owner/repo`、`/compare a/b c/d[,e/f]`;`runScore/runCompare` + `message.plain`(3500 截断);/start 帮助更新。
- **Discord**:注册 `/score`、`/compare`(repos 字符串选项);score 卡以 `message.markdown` 直接回复;compare 同(2000 字符截断)。
- **飞书**(`apps/bot/src/platforms/feishu.ts`,api/feishu.ts 复用):文本前缀 `score `/`compare `/裸链接→小报;文案中文化;`getTenantToken` 进程内缓存(expire − 300s);发送函数共享 token 获取。

## 5. rubric 收敛 + 文案派生

- `score.ts`:将 stars 门槛(300/1000/2000)、评分折损等散落数字归拢为导出常量对象(如 `SCORE_RUBRIC`),`SCORE_DIMENSION_WEIGHTS` 已存在;**纯重命名/挪位,数值零变化**。
- `ScoreView.tsx`:权重说明行从 `SCORE_DIMENSION_WEIGHTS` 派生(五维名 + `各 ${Math.round(w*100)}%`)。

## 6. 兼容性 / 回滚

- 公开 API 响应面不变;dev 中间件新增限流/缓存与 413 保持(Vercel 侧由平台限制兜底)。
- 风险点:Vite 对 `vite.config.ts` 相对导入 core .ts 的打包行为(E2E 层 2 验证;失败则退化为从 `@repo-gossip/core` dist 导入 + dev 前置 build)。
- 回滚单位:每逻辑变更独立提交,可单独 revert。
