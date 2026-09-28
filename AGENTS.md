# AGENTS.md — 开发协议

给在本仓库工作的 AI/人类贡献者的硬性约定。工程范式照搬小驴人脉（D-0010）。

## 铁律

1. **数据主权**（D-0001）：一切文章状态写文档属性（`custom-clip-*`，键名唯一事实源=src/domain/schema.ts）；
   插件 saveData 只存派生索引与设置；**不覆盖用户手填字段**（url/status/priority/rating）。
2. **契约先行**：存储/端点约定先改 `docs/DATA-CONTRACT.md` 再改代码；所有决策记 `docs/DECISIONS.md`（D-xxxx）；
   任务记 `TODO.md`（T-xxxx）。
3. **不臆造思源 API**：端点形状以 DATA-CONTRACT §5 与 `scripts/spike/` 实证为准；新端点先 spike 再进 api/。
4. **分层单向依赖**（`tests/architecture.test.ts` 守门）：domain/ 纯函数层禁 import svelte/siyuan/api/services；
   内核端点字符串只准出现在 `src/api/`；UI 禁直接 fetch。
5. **属性读写只准经 `services/clip-store.ts`**（schema 校验 + 手填字段保护 + 索引同步）；禁裸调 attr 端点写 `custom-clip-*`。
6. **版本语义化**（D-0005）：每里程碑一版不跳号；打 tag/发 Release/提交集市逐次请示作者。
7. **i18n 双名**：`public/i18n/zh_CN.json + en_US.json`，键集合必须一致（tests/i18n.test.ts 守门）；
   新增 UI 文案先补两份键再引用。
8. **UI 纪律**：颜色一律 b3 CSS 变量，类名前缀 `glean-`；不做通用聊天窗、不自带 LLM key（AI 走 `/api/ai/*`，
   逐功能开关默认关，失败静默降级）。
9. **zip 产物 mtime 用真实构建时间**；发版走仓库 Latest Release 的 package.zip。
10. 移动端判定用 `getFrontend()`，禁 UA 嗅探。

## 工作流

- 里程碑：M0 spike ✅ → M1 地基 ✅ → M2 数据库视图与统计 → M3 AI 富化 → M4 抗吃灰内核 → M5 生态（详见 docs/ROADMAP.md）。
- 每个里程碑结束：更新 `docs/PROGRESS.md`、有决策写 `docs/DECISIONS.md`、跑 `pnpm check && pnpm test`、git 提交。
- 测试：`pnpm test`（域层纯函数 + i18n + 架构守门）；隔离内核 spike/E2E 参照 `scripts/spike/glean-spike.mjs`
  （**测试前必须 `/api/setting/setBazaar {trust:true}`**，见 spike 脚本注释）。
- 需要作者真机操作的验收项记入 `docs/BLOCKERS.md`（B-xxx），不阻塞后续开发。

## 续跑口令

新会话续跑本插件开发时，直接对 agent 说：

> 阅读 D:\思源插件\小驴拾遗\docs\HANDOFF.md，按其中"下一步"继续开发；工程纪律见 AGENTS.md 与 docs/DECISIONS.md，不许违反复述。

HANDOFF.md 由每轮开发结束时更新（当前状态 / 已验证契约 / 下一步任务 / 注意事项）。
