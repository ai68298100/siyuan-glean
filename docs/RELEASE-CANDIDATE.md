# 发布候选复核

> 2026-10-16 进入 `v1.3.5` 发布候选：补齐索引同步失败反馈，并校准 S5 真实验收矩阵。真实宿主、读屏、移动端和外部能力仍按能力矩阵及 B-0002、B-0004–B-0008 验收。
>
> 本文记录本次 `v1.3.5` 候选、构建和 GitHub 发布证据；上一版 `v1.3.4` 已发布；集市 PR 仍需单独授权，不执行。

## 1. 当前候选

| 项目 | 结果 | 证据 |
|---|---|---|
| 源版本 | `1.3.5` | `package.json` 与 `plugin.json` 一致 |
| 变更记录 | 已有 `v1.3.5` 条目 | `docs/CHANGELOG.md` |
| 类型与 Svelte 检查 | 通过，0 错误/0 警告 | `pnpm check` |
| 全量测试 | 通过，1339/1339 | `pnpm test` |
| 生产构建 | 通过 | `pnpm build` |
| 发布产物 | 通过，420187B；SHA-256 `CDE715B78C1B907B62123A88BD0FF99020E39B64DE472D5FA27F5C709F316C0E` | `pnpm check:release`；zip mtime 2026-10-16 04:26:20 +08:00 |
| 性能门禁 | 通过；10k 扫描 8.20ms、索引重建 69.06ms、筛选 2.47ms、导入解析 35.17ms、今日拾遗 3.40ms | `pnpm perf:check` |
| 视觉矩阵 | 登记检查通过；24 个真实宿主案例仍待 B-0002 | `pnpm visual:check` |
| 任务账本与差异 | 通过 | `pnpm task:ledger -- --check`、`git diff --check` |
| 隔离内核 | 以本轮实际证据为准；不替代真实宿主验收 | `scripts/e2e/` 与 `scripts/spike/` |
| GitHub 发布 | 待本轮门禁与推送 | 目标 tag/Release：`v1.3.5` |
| GitHub 工作流 | Quality gates、CodeQL 均成功 | [Quality gates 38579950262](https://github.com/ai68298100/siyuan-glean/actions/runs/38579950262)、[CodeQL 38579950264](https://github.com/ai68298100/siyuan-glean/actions/runs/38579950264) |

本轮变更重点是索引同步失败反馈贯通、主要写入口的回归保护和 S5 验收矩阵校准。AI 仍默认手动且需要用户配置通道；详细前置条件以[能力矩阵](CAPABILITY-MATRIX.md)为准。

## 2. 仍需真实环境证据

- 在隔离工作区做覆盖安装和重启，确认旧索引/设置兼容；真实工作区不做破坏性试验。
- 禁用或卸载后检查文档 `custom-clip-*` 属性仍在，重装后重建索引；该项沿用 B-0002 数据主权验收。
- 用真实思源宿主采集截图/GIF，补齐视觉矩阵要求与今日拾遗、筛选和统计的真实观感；不能用原型图或 SSR fixture 替代。
- 按 B-0001、B-0002、B-0004–B-0008 完成真实剪藏、界面、AI、导入、快照、收集箱和打卡验收。
- 集市 PR 仍需作者单独授权。

## 3. 发布顺序

1. 同步 `package.json`、`plugin.json`、双语 README 和 CHANGELOG，确认版本为 `1.3.5`。
2. 运行 `pnpm check`、`pnpm test`、`pnpm build`、`pnpm check:release`、`pnpm perf:check`、`pnpm visual:check`、`pnpm task:ledger -- --check` 与 `git diff --check`。
3. 提交并推送 `main`，创建 annotated tag `v1.3.5` 并推送。
4. 创建 `v1.3.5` GitHub Release 并上传本轮 `package.zip`，核对远端大小与 SHA-256。

## 4. 不得提前承诺

- README 和能力矩阵继续使用保守口径：AI 可选、默认手动、需要配置模型；收集箱、外部导入、快照和打卡桥分别注明订阅/文件、assets、双插件和协议前提。
- 真实证据未回填前，不写“全平台已验证”或“自动同步”；GitHub workflow、单元测试和隔离 E2E 不替代真实宿主、真实模型和外部服务验收。
