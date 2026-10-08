# 发布手册（RELEASE）

> 铁律（D-0005）：版本语义化，每里程碑一版，不跳号。打 tag / 发 Release / 提交集市**逐次请示作者**。
> 以下 M1–M5 版本表是原计划；实际已发布 v1.0.0–v1.0.4，当前修复/验收顺序以 [ROADMAP.md](ROADMAP.md) S0–S6 为准。未通过 S6 门禁前不确定下一版本号。

## 版本节拍

| 里程碑 | 版本 |
|---|---|
| M1 地基 | v1.0.0 |
| M2 数据库视图与统计 | v1.1.0 |
| M3 AI 富化 | v1.2.0 |
| M4 抗吃灰内核 | v1.3.0 |
| M5 生态 | v1.4.0+ |

## 发布门禁（全绿才可发）

1. `pnpm check`（tsc + svelte-check）零错误
2. `pnpm test`（node --test 全量单测 + 架构守门）全绿
3. 隔离内核 E2E 通过（含数据主权用例：卸载插件后 `custom-clip-*` 属性仍在）
4. `plugin.json` 与 `package.json` 版本一致（`pnpm update-version`）
5. `docs/PROGRESS.md` 本里程碑记账完成；`docs/CHANGELOG.md` 追加条目（建立时）
6. 对外描述通过 `docs/CAPABILITY-MATRIX.md` 与 `tests/capability-matrix.test.ts`；未验收的外部能力必须保留前置条件和降级说明

## 步骤

1. `pnpm build` 产出 `dist/` + `package.zip`（zip mtime 必须是真实构建时间，见 vite.config 注释）
2. GitHub 打 tag `vX.Y.Z` 并发 Release，附件 `package.zip`（需作者确认）
3. 集市：fork siyuan-note/bazaar → plugins.txt 追加一行 → PR（**需作者单独授权，默认不做**）

## 历史发布

| 版本 | 日期 | 内容 |
|---|---|---|
| v1.0.0 | 2026-09-29 | 首个公开版本：读库管理/每日重浮/统计，以及 AI、导入器、制卡、快照、收集箱、打卡桥等可选能力代码入口（详见 CHANGELOG；真实验收按能力矩阵） |
| v1.0.1 | 2026-09-29 | 顶栏入口修复 |
| v1.0.2 | 2026-09-29 | 顶栏工作台与 Dock 入口分工、首启引导 |
| v1.0.3 | 2026-09-29 | 设置后刷新、`#剪藏` 标签候选 |
| v1.0.4 | 2026-09-29 | 独立工作台浮窗、查询失败容错 |
| v1.1.0 | 2026-09-30 | 产品重整 S1–S4：可信收录/迁移器重做/统一阅读时间线/载体策略/完成时间/今日拾遗理由/超龄清单/内嵌阅读页签+摘录+AI 伴读/AI 标签筛选/命令动作/待分拣术语（详见 CHANGELOG） |
