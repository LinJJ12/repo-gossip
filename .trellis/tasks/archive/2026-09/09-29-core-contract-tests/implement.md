# Implement: 核心契约单测补强

## Checklist (order)

1. **抽取纯函数** — `packages/core/src/github.ts`：
   - `filterNonPullIssues(raw)`：剔除带 `pull_request` 的条目
   - `mapReleasesInWindow(raw, sinceMs, max)`：映射 → 剔空 tag → 窗口过滤 → 降序 → 裁剪
   把 `fetchActivity` 内对应闭包改为调用它们，**逐行比对确保行为不变**（尤其是先 filter 再 sort 再 slice 的顺序）。
2. **导出** — `packages/core/src/index.ts` 按需导出（若只供测试用，可不导出公开 API，测试可直接从 `github.ts` 导入，与 `core.test.ts` 的既有做法一致）。
3. **Fixtures** — 评估是否抽 `test/fixtures.ts`（`emptySnapshot` / `activitySnapshot`）；若抽，同步改 `core.test.ts` 的 import 并保证用例仍全绿。
4. **新测试文件** — `test/core-contract.test.ts`：
   - `parseTabloidJson`：4 个用例（正常 / 数组字段为字符串 / 字段缺失 / 中文键名）
   - `toDiscordEmbed`：3 个用例（标题清洗 / 4000 截断 / 温度色）
   - `toFeishuCard`：3 个用例（msg_type / template / 4000 截断）
   - `mapReleasesInWindow`：4 个用例（窗口内 / 窗口外 / 空 tag / 降序+上限）
   - `filterNonPullIssues`：2 个用例（剔除 PR / 保留 issue）
5. **回归断言** — 沿用 `core.test.ts` 风格，对中文文案与标点加断言（如 `assert.doesNotMatch(line, /\?\w/)`）。
6. **Validation** — `npm test`、`npm run typecheck`；确认用例数增加且无 fail。

## Validation

```bash
npm test
npm run typecheck -w @repo-gossip/core
npm run gossip -- vercel/next.js --offline   # 冒烟：抽取纯函数未改变实际行为
```

## Risky files

- `packages/core/src/github.ts` — 抽取纯函数时若改变了 filter/sort/slice 顺序，会静默改变出报内容（特别是 Release 窗口）
- `test/core.test.ts` — 若抽共享 fixtures，需保证既有 79 个用例不回归

## Review gates

- [ ] 抽取后的 `fetchActivity` 行为与抽取前一致（顺序、裁剪、字段映射逐项核对）
- [ ] 新增测试全部离线，无网络/LLM 依赖
- [ ] Release 窗口外剔除有用例守护

## Rollback points

- 步骤 1 单独一个提交：若冒烟发现 Release/Issue 行为异常，只回退这一步即可

## Explicitly not doing

- 覆盖率门禁、CI 改动
- 真实 API 的集成测试
- 扩展端原生 JS 的测试化（需先模块化，另立任务）
