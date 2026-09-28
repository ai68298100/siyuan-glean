# HANDOFF — 续跑交接（每轮开发结束更新本页）

> 续跑口令（新会话直接粘贴）：
> **阅读 D:\思源插件\小驴拾遗\docs\HANDOFF.md，按其中"下一步"继续开发；工程纪律见 AGENTS.md 与 docs/DECISIONS.md，先通读 TODO.md 与 docs/DATA-CONTRACT.md 再动手。**
> 如有更具体的口令，以最近一轮更新的"下一步"为准。

## 当前状态（2026-09-29 第一轮开发完成）

- 仓库：`D:\思源插件\小驴拾遗` = GitHub [ai68298100/siyuan-glean](https://github.com/ai68298100/siyuan-glean)（main 分支已推送）。
- 定调：**人脉方案**（Vite 8 + Svelte 5 + TS + pnpm，CJS 单文件），内核源码级证据见 D-0010。
- 质量：`pnpm check` 0 错误；`pnpm test` 25/25；`pnpm build` + 发布门禁 14/14；M0 spike 7/7（隔离内核）。
- 功能：M0 + M1 全量落地（属性服务/迁移器/Dock 面板五队列/收录三件套/设置/派生索引/README 双语）。
- 版本：plugin.json=package.json=**0.1.0**（工作版本号；M1 真机验收后发 **v1.0.0**，打 tag 需作者确认）。
- 推送 GitHub 已获作者授权（本轮已推）；**集市 PR 未授权，禁做**。

## 已实证契约（动手前必读 docs/DATA-CONTRACT.md §5 + docs/spike-report.md）

- `batchGetBlockAttrs` 响应是 `{[id]: attrs}` 映射；`batchSetBlockAttrs` 请求 `{blockAttrs:[{id,attrs}]}`；删除属性 null 或空串皆可（插件统一 null）。
- 千篇库 `ial LIKE` 直查 14~50ms → **不要**给面板加写放大方案，T-1403 已关闭。
- `semanticSearchBlock`：`types` 是 map（`{d:true}`）、**无 boxes 参数**、嵌入未启用时 code=0 空结果 → 降级判断必须先查 `embeddingStat().enabled`。
- 隔离内核测试插件前必须 `/api/setting/setBazaar {trust:true}`（spike 脚本已内置）。
- 内核加载插件：CommonJS 单文件 index.js + 默认导出 extends Plugin；i18n 双名 `zh_CN.json`+`en_US.json` 各自全量。

## 架构速记

- `src/index.ts` 薄壳（dock+tab 双挂载、命令、右键菜单）；`types.ts` GleanFacade 门面（组件不反向 import 壳）。
- `src/api/client.ts` 唯一内核传输层；`src/domain/` 纯函数（schema.ts=属性唯一事实源）；`src/services/`（clip-store=属性单点读写+手填字段保护；index-store=派生索引；migrate-service=dry-run+分批续跑；settings）。
- `src/ui/`：DockPanel（五队列+待收录区+批量条）/MigrateDialog/SettingsView；样式全局在 `src/index.scss`（glean- 前缀 + b3 变量）。
- 测试：`tests/`（schema/migrate/i18n/architecture），跑法 `pnpm test`；测试文件 import 要带 `.ts` 扩展名（node --test 直跑）。
- 网络：GitHub 直连超时，**推送/拉取走代理 `git -c http.proxy=http://127.0.0.1:7897 …`**（凭据在 Windows 凭据管理器，ai68298100）。

## 待作者事项（不阻塞开发，勿催）

- B-0001 官方剪藏扩展实剪 3 站核对；B-0002 dock/顶栏真机目视；两者后作者验收 M1 后再发 v1.0.0（tag 逐次请示）。

## 下一步（按优先级，即 M2）

1. **T-1200 挂库向导**：一键创建"读库数据库"（AV）并把收录文档挂入（`addAttributeViewBlocks isDetached:false`，字段映射 status/rating/words/minutes，看板视图即状态机；拖卡改状态=写文档属性双向同步）。**注意**：AV 端点形状照搬小驴人脉 `docs/DATA-CONTRACT.md`+`src/api/av.ts`（同机可读 `D:\思源插件\小驴人脉\siyuan-contacts\`），但先把要用的端点补进 spike 脚本在本机内核复验。
2. **T-1201 统计页**：已读/字数/站点/标签分布 + Markdown 周报导出（数据从 index 聚合，纯函数放 domain/stats.ts + 单测）。
3. **T-1202 高亮列表侧栏 v1**：读当前文档引述块聚合（DATA-CONTRACT §4 形态）。
4. M2 完成后：记账 PROGRESS/TODO → 提交推送（推送已授权）→ 更新本页。

再往后：M3 AI 富化（T-1300~1303，设计红线见 D-0004/D-0007：官方通道、逐功能开关、静默降级、先查 embeddingStat.enabled）→ M4 抗吃灰（T-1400~1402，平静原则）→ M5 生态（逐项请示作者）。
