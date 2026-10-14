# 发布候选复核

> 2026-10-14 进入 `v1.3.4` 发布候选：统一全局设计令牌，并收口异步操作、索引写入和迁移恢复的可靠性。真实宿主、读屏、移动端和外部能力仍按能力矩阵及 B-0002/B-0005 验收。
>
> 本文记录本次 `v1.3.4` 候选、构建和 GitHub 发布证据；上一版 `v1.3.2` 与 `v1.3.3` 已发布；集市 PR 仍需单独授权，不执行。

## 1. 当前候选

| 项目 | 结果 | 证据 |
|---|---|---|
| 源版本 | `1.3.4` | `package.json` 与 `plugin.json` 一致 |
| 变更记录 | 已有 `v1.3.4` 条目 | `docs/CHANGELOG.md` |
| 类型与 Svelte 检查 | 通过，0 错误/0 警告 | `pnpm check` |
| 全量测试 | 通过，1334/1334 | `pnpm test` |
| 生产构建 | 通过 | `pnpm build` |
| 发布产物 | 通过，418766B；SHA-256 `6603FD964FA82C6B943FC6CECC155F23D2FF443DB4EB2016D4AF4823E022DB5E` | `pnpm check:release`；zip mtime 2026-10-14 22:01:46 +08:00 |
| 性能门禁 | 通过；10k 扫描 7.79ms、索引重建 66.05ms、筛选 2.97ms、导入解析 33.82ms、今日拾遗 3.44ms | `pnpm perf:check` |
| 视觉矩阵 | 登记检查通过；24 个真实宿主案例仍待 B-0002 | `pnpm visual:check` |
| 任务账本与差异 | 通过 | `pnpm task:ledger -- --check`、`git diff --check` |
| 隔离内核 | 以本轮实际证据为准；不替代真实宿主验收 | `scripts/e2e/` 与 `scripts/spike/` |
| GitHub 发布 | 已完成，远端附件校验一致 | [v1.3.4 Release](https://github.com/ai68298100/siyuan-glean/releases/tag/v1.3.4)；tag/Release 提交 `0b864b9fb94c0a046fbe3d644f1a4a090a7a65f4`；附件 418766B，SHA-256 `6603FD964FA82C6B943FC6CECC155F23D2FF443DB4EB2016D4AF4823E022DB5E` |

本轮变更重点是设计令牌收敛、统一异步控件状态、索引写入结果一致性、迁移检查点压缩和 AV 刷新延迟保护。AI 仍默认手动且需要用户配置通道；详细前置条件以[能力矩阵](CAPABILITY-MATRIX.md)为准。

## 2. 仍需真实环境证据

- 在隔离工作区做覆盖安装和重启，确认旧索引/设置兼容；真实工作区不做破坏性试验。
- 禁用或卸载后检查文档 `custom-clip-*` 属性仍在，重装后重建索引；该项沿用 B-0002 数据主权验收。
- 用真实思源宿主采集截图/GIF，补齐视觉矩阵要求与今日拾遗、筛选和统计的真实观感；不能用原型图或 SSR fixture 替代。
- 按 B-0001、B-0002、B-0004–B-0008 完成真实剪藏、界面、AI、导入、快照、收集箱和打卡验收。
- 集市 PR 仍需作者单独授权。

## 3. 发布顺序

1. 同步 `package.json`、`plugin.json`、双语 README 和 CHANGELOG，确认版本为 `1.3.4`。
2. 运行 `pnpm check`、`pnpm test`、`pnpm build`、`pnpm check:release`、`pnpm perf:check`、`pnpm visual:check`、`pnpm task:ledger -- --check` 与 `git diff --check`。
3. 提交并推送 `main`，创建 annotated tag `v1.3.4` 并推送。
4. annotated tag `v1.3.4` 与 GitHub Release 已发布；远端 `package.zip` 大小 418766B，SHA-256 `6603FD964FA82C6B943FC6CECC155F23D2FF443DB4EB2016D4AF4823E022DB5E`，与本地一致。

## 4. 不得提前承诺

- README 和能力矩阵继续使用保守口径：AI 可选、默认手动、需要配置模型；收集箱、外部导入、快照和打卡桥分别注明订阅/文件、assets、双插件和协议前提。
- 真实证据未回填前，不写“全平台已验证”或“自动同步”；GitHub workflow、单元测试和隔离 E2E 不替代真实宿主、真实模型和外部服务验收。
