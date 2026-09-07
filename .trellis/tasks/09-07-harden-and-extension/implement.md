# Implement — 生产硬化与浏览器插件

## Execution order

1. **Start `09-07-public-api-byok`** — 公开契约 + BYOK + CORS/background 约定 + Web 修复 + kill-switch env  
2. **`09-07-add-ci`** — GitHub Actions  
3. **`09-07-rate-limit-cache`** — 依赖公开路径已存在  
4. **`09-07-github-resilience`**  
5. **`09-07-deploy-bot-parity`**  
6. **`09-07-tests-and-hygiene`** — 可吸收前几项测试债  
7. **`09-07-chrome-extension-mvp`** — 依赖 BYOK 头稳定；限流已上更佳  
8. 父任务集成核对 → 各子任务 archive → 父 archive  

每个子任务：补齐自身 `prd.md`（及复杂者的 design/implement）→ 用户批准该子任务规划（或父摘要已覆盖时确认「开始子任务 N」）→ `task.py start <child>` → implement → check → 再下一个。

## Parent validation (integration)

```bash
npm test
npm run typecheck
# 手动：Web 生产/预览出报；带/不带 BYOK 头 curl；插件加载后在公开仓点按钮
```

## Rollback points

- 子任务 1：`GOSSIP_REQUIRE_WEBHOOK_SECRET=1`  
- 子任务 3：提高限额或关缓存 env  
- 子任务 7：卸扩展，不影响服务端  

## Before first `task.py start`

- [x] 父 `prd.md` / `design.md` / `implement.md`  
- [ ] 用户批准本最终规划摘要  
- [ ] 仅 start **第一个**子任务 `09-07-public-api-byok`（先补齐其子 PRD）  
