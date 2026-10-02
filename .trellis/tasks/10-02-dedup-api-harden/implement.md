# Implement: 重构去重与 API 加固

顺序执行,每步后跑对应验证;分支 `refactor/dedup-api-harden`。

## A. 共享 API handler
- [ ] A1 新建 `packages/core/src/http-api.ts`(gossip + badge 处理器,deps 注入,500 脱敏,badge 限流)并在 `index.ts` 导出
- [ ] A2 `api/gossip.ts` / `api/badge/[owner]/[repo].ts` 改薄适配器;删除 `api/_auth.ts`
- [ ] A3 新建 `test/http-api.test.ts`(路由/校验/限流/缓存/脱敏/badge 永不破图)
- [ ] A4 重写 `apps/web/vite.config.ts` 中间件为协议转换
- 验证:`npm test`、`npm run typecheck`

## B. 雷达/配色单源
- [ ] B1 core `formatCompareRadarSvg` 加 `ariaLabel` 选项
- [ ] B2 `CompareView.tsx` 删本地几何/配色,改 import core
- 验证:`npm test` + dev server 肉眼/浏览器对比雷达渲染

## C. history 单源
- [ ] C1 `apps/extension/history-logic.js` 升级为严格语义(web 版行为)+ 邻接 `.d.ts`
- [ ] C2 web `history.ts` 改类型门面(副作用导入 + re-export)
- [ ] C3 修两套测试断言冲突(如有)
- 验证:`npm test`;`npm run web:build` 通过(含外部目录导入)

## D. Bot 对齐
- [ ] D1 core 导出 `LOOSE_REPO_PATTERN`;telegram/feishu 删本地 REPO_RE
- [ ] D2 telegram 加 /score /compare + 每用户限流;discord 加 /score /compare;feishu 加文本命令 + token 缓存 + 中文文案
- [ ] D3 `apps/bot/src/index.ts` `bot.start().catch(...)`;平台层每用户限流
- [ ] D4 补/改 bot 参数解析测试
- 验证:`npm test`、`npm run typecheck -w @repo-gossip/bot`

## E. rubric 收敛
- [ ] E1 `score.ts` 魔法数字归拢为导出常量(数值零变化)
- [ ] E2 `ScoreView.tsx` 权重文案派生
- 验证:`npm test`(score 测试钉行为)、typecheck

## F. 全量验证(三层 E2E)
- [ ] F1 `npm test` + `npm run typecheck` + `npm run web:build` 全绿
- [ ] F2 CLI 真实网络:`gossip --score`、`gossip --compare`、`--offline`
- [ ] F3 dev server:`npm run web`(后台),curl 全端点矩阵 —— gossip GET 健康检查/GET repo/POST 各 mode/format/非法 JSON/缺参/405/OPTIONS CORS/X-Cache HIT/MISS/429 限流;badge 正常/lang=en/非法路径/限流后 N/A
- [ ] F4 浏览器 UI 全流程(browser-use):出报 → 验金 → 对比 → 最近历史;控制台无错误
- [ ] F5 收尾清理(进程 taskkill、临时文件)

## G. 收尾
- [ ] G1 spec 更新(web spec 中间件描述、core spec 新模块)
- [ ] G2 README/architecture/.env.example 同步(badge 限流 env、bot 新命令)
- [ ] G3 中文分批提交;Trellis finish + archive;推送 master
