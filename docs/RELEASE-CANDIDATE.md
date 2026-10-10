# 发布候选复核

> 2026-10-10 定版 v1.3.3：本轮修复 AV 刷新异步竞态并收口阅读伴读性能/反馈；真实宿主/作者验收边界仍按 B-0002/B-0005 保留。
>
> 本文记录本次 `v1.3.3` 候选、构建和 GitHub 发布证据；上一版 `v1.3.2` 已发布；集市 PR 仍需单独授权，不执行。

## 1. 当前候选

| 项目 | 结果 | 证据 |
|---|---|---|
| 源版本 | `1.3.3` | `package.json` 与 `plugin.json` 一致 |
| 变更记录 | 已有 `v1.3.3` 条目 | `docs/CHANGELOG.md` |
| 类型与 Svelte 检查 | 通过，0 错误/0 警告 | `pnpm check` |
| 全量测试 | 通过，1245/1245 | `pnpm test` |
| 隔离内核主链 | 通过，58/58；本轮复跑，真实内核 3.8.7-alpha.6、独立临时工作区；AV spike 6/6 | `node scripts/e2e/s1-flow.mjs`；Bazaar trust 仅设置在隔离内核；稳定 3.8.6 二进制当前机器不可用 |
| 生产构建 | 通过 | `pnpm build` |
| 性能门禁 | 通过当前机器合成基线 | `pnpm perf:check` |
| 视觉矩阵 | 登记检查通过；24 个真实宿主案例仍待 B-0002 | `pnpm visual:check` |
| 发布产物 | 通过，388844B | `pnpm check:release`；SHA-256：`A032295B06990F065B21BE02D425CE72F1E465035F476044B10E96B8E8523AC8` |
| GitHub 工作流 | Quality gates、CodeQL 均通过 | [Quality gates 38068573521](https://github.com/ai68298100/siyuan-glean/actions/runs/38068573521)、[CodeQL 38068573513](https://github.com/ai68298100/siyuan-glean/actions/runs/38068573513) |
| GitHub 发布 | 待本轮构建后完成 | `v1.3.3` tag、Release 和 `package.zip` 远端哈希待回填 |

版本已按 D-0005 定版为 `1.3.3`。本轮主要变更为 AV 刷新异步竞态修复、阅读伴读缓存/反馈优化和双语 README 更新，明细见 `docs/CHANGELOG.md` 与 `docs/PROGRESS.md`。集市仍需单独授权。

## 2. 仍需真实环境证据

- 在隔离工作区做覆盖安装和重启，确认旧索引/设置兼容；在真实工作区不做破坏性试验。
- 禁用或卸载后检查文档 `custom-clip-*` 属性仍在，重装后重建索引；该项沿用 B-0002 数据主权验收。
- 用真实思源宿主采集截图/GIF，补齐视觉矩阵要求与今日拾遗、筛选和统计的真实观感；不能用原型图或 SSR fixture 替代。
- 按 B-0001、B-0002、B-0004–B-0008 完成真实剪藏、界面、AI、导入、快照、收集箱和打卡验收。
- 集市 PR 仍需作者单独授权。

## 3. 发布前顺序

1. 确认版本号与 CHANGELOG，`dist` 重新构建并校验 `package.zip`（已通过）。
2. `pnpm check`、`pnpm test`、`pnpm build`、`pnpm check:release`、`pnpm perf:check`、`pnpm visual:check` 和隔离 S1 E2E 均已通过。
3. 候选提交和 GitHub workflow 结果待本轮推送后回填。
4. annotated tag `v1.3.3` 与 GitHub Release 待本轮构建、提交和推送后完成；远端下载包大小与 SHA-256 待回填。

## 4. 不得提前承诺

- 集市和 README 继续使用能力矩阵的保守对外口径：AI 可选、默认手动、需要配置模型；收集箱、外部导入、快照和打卡桥分别注明订阅/文件、assets、双插件和协议前提。
- 真实证据未回填前，不写“全平台已验证”或“自动同步”；GitHub workflow、单元测试和隔离 E2E 不替代真实宿主、真实模型和外部服务验收。
