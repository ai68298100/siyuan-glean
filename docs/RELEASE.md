# 发布手册（RELEASE）

> 铁律（D-0005）：版本语义化，每里程碑一版，不跳号。打 tag / 发 Release / 提交集市**逐次请示作者**。

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

## 步骤

1. `pnpm build` 产出 `dist/` + `package.zip`（zip mtime 必须是真实构建时间，见 vite.config 注释）
2. GitHub 打 tag `vX.Y.Z` 并发 Release，附件 `package.zip`（需作者确认）
3. 集市：fork siyuan-note/bazaar → plugins.txt 追加一行 → PR（**需作者单独授权，默认不做**）

## 历史发布

（暂无）
