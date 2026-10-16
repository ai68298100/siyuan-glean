# 发布候选复核

> 2026-10-16 `v1.3.6` 紧急修复已发布为 Latest：修复 GitHub #16 相关的阅读上下文反复刷新，并检查原生编辑器、独立阅读页签和工作台预览中的同类入口。真实宿主、读屏、移动端和外部能力仍按能力矩阵及 B-0002、B-0004–B-0008 验收。
>
> 本文记录本次 `v1.3.6` 候选、构建和 GitHub 发布证据；上一版 `v1.3.5` 与更早的 `v1.3.4` 已发布。本轮作者已要求紧急修复并发布；集市 PR 仍需单独授权，不执行。

## 1. 当前候选

| 项目 | 结果 | 证据 |
|---|---|---|
| 源版本 | `1.3.6` | `package.json` 与 `plugin.json` 一致 |
| 变更记录 | 已有 `v1.3.6` 条目 | `docs/CHANGELOG.md` |
| 类型与 Svelte 检查 | 通过，0 错误/0 警告 | `pnpm check` |
| 全量测试 | 1353/1353 通过；本轮新增 14 项回归 | `pnpm test`；重复加载、切回/分屏/重入、内嵌排除、背景刷新、错误重试及三页显示保留 |
| 生产构建 | 通过，253 modules；JS 727.12kB、CSS 345.76kB | `pnpm build` |
| 发布产物 | 421105B；SHA-256 `C1191CB0C50382B80489471B6C2912D7C87F3BD1DE3D3C37CF87FFE5E5E87616`；真实 mtime `2026-10-16 10:58:23 +08:00` | `pnpm check:release` 通过 |
| 性能门禁 | 通过；10k 合成输入：范围扫描 7.64ms、索引重建 68.45ms、筛选 2.68ms、导入 36.99ms、重浮 3.34ms | `pnpm perf:check` |
| 视觉矩阵 | 登记检查通过；0/24 已捕获，24 个完整真实宿主案例仍待 B-0002 | `pnpm visual:check`；本轮冒烟截图不冒充整套视觉验收 |
| 任务账本与差异 | 通过；文档与账本定向 10/10 通过 | `pnpm task:ledger -- --check`、`git diff --check` |
| 隔离内核 | S1 服务级 E2E 58/58 通过；不替代真实主工作区验收 | 本轮 `scripts/e2e/s1-flow.mjs`，证据 `%TEMP%/siyuan-glean-s1-1792119060362-19972/s1-run-evidence.json` |
| 隔离宿主界面 | 修复包覆盖加载；引导 2→3 步、普通文档、文章切回与工作台预览冒烟通过；warn/error 日志为空 | 思源 `3.8.8-alpha.1`、独立工作区、IAB（Chrome 当前不可用）；正文切回保留上下文实例 `c1`，普通文档可见阅读栏 0，内嵌预览重复注入 0 |
| GitHub 发布 | `v1.3.6` 已公开，Latest，非预发布；发布于 `2026-10-16 11:08:32 +08:00` | [Release](https://github.com/ai68298100/siyuan-glean/releases/tag/v1.3.6)；annotated tag 指向 `408d92cd159886033263f2da7048f45d757a56e5`；公开附件重新下载，421105B、SHA-256 与本地产物一致 |
| GitHub 工作流 | 发布提交两项均成功 | [Quality gates 38843676470](https://github.com/ai68298100/siyuan-glean/actions/runs/38843676470)、[CodeQL 38843676467](https://github.com/ai68298100/siyuan-glean/actions/runs/38843676467) |

本轮变更重点是重复加载/切换事件幂等、后台刷新保留已判定内容或无栏状态，以及内嵌编辑器避免重复注入。AI 仍默认手动且需要用户配置通道；详细前置条件以[能力矩阵](CAPABILITY-MATRIX.md)为准。

界面截图：`output/hotfix-v136/native-reading-context.jpg`（隔离合成数据，本地忽略产物）。宿主启动清单原记录 1.3.5，本轮已覆盖为 1.3.6 并重载，manifest 与 JS 均核对；测试包和最终包的 JS SHA-256 同为 `558BDC688056818BDE797B14B251E8F8FD7C23E96605E274B6557259592BCE3A`。隔离会话已停止。原 issue 视频附件未能读取，本轮未在原设备复现其高频闪烁；已验证的是代码中的重复事件链修复、相关回归与隔离宿主冒烟，#16 保留供原反馈场景复测。

## 2. 仍需真实环境证据

- 在隔离工作区做覆盖安装和重启，确认旧索引/设置兼容；真实工作区不做破坏性试验。
- 禁用或卸载后检查文档 `custom-clip-*` 属性仍在，重装后重建索引；该项沿用 B-0002 数据主权验收。
- 用真实思源宿主采集截图/GIF，补齐视觉矩阵要求与今日拾遗、筛选和统计的真实观感；不能用原型图或 SSR fixture 替代。
- 本轮特别检查普通笔记、已收录文章、独立阅读页签与工作台预览的切换/刷新：重复事件不重挂阅读栏，已判定无栏的普通笔记不反复出现加载骨架。
- 按 B-0001、B-0002、B-0004–B-0008 完成真实剪藏、界面、AI、导入、快照、收集箱和打卡验收。
- 集市 PR 仍需作者单独授权。

## 3. 发布顺序

1. 同步 `package.json`、`plugin.json`、双语 README 和 CHANGELOG，确认版本为 `1.3.6`。
2. 运行 `pnpm check`、`pnpm test`、`pnpm build`、`pnpm check:release`、`pnpm perf:check`、`pnpm visual:check`、`pnpm task:ledger -- --check` 与 `git diff --check`。
3. 门禁通过后提交并推送 `main`，创建 annotated tag `v1.3.6` 并推送。
4. 创建 `v1.3.6` GitHub Release 并上传本轮 `package.zip`，核对远端大小与 SHA-256 后回填证据。

## 4. 不得提前承诺

- README 和能力矩阵继续使用保守口径：AI 可选、默认手动、需要配置模型；收集箱、外部导入、快照和打卡桥分别注明订阅/文件、assets、双插件和协议前提。
- 真实证据未回填前，不写“全平台已验证”或“自动同步”；GitHub workflow、单元测试和隔离 E2E 不替代真实宿主、真实模型和外部服务验收。
