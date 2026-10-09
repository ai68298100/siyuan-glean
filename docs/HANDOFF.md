# HANDOFF — 续跑交接（每轮开发结束更新本页）

## 当前有效交接（2026-10-09 T-3321/D-0196 v1.3.1 性能补丁发布）

- `v1.3.1` 发布内容是 T-3320 的大库刷新查重与看板分桶优化；版本、双语 README、CHANGELOG 和发布记录已同步。
- `pnpm check`、`pnpm test` 1226/1226、`pnpm build`、`pnpm check:release`、`pnpm perf:check`、任务账本和 `git diff --check` 已通过；`package.zip` 377958B，SHA-256 为 `e7419db06a5e3c293be5a763d118f2a85035d9a3ca1fa46411f5e8310b898c10`。
- 初始发布提交 `64b537ca76172f51dd7b18056950ab078a9210af` 已通过 `gh api` 更新至 GitHub；最终发布记录提交 `33b81df9ffb0fbb8aab9bc7a0c4b6cdb8921461a` 已推送 `main`，annotated tag `v1.3.1` 与 [GitHub Release](https://github.com/ai68298100/siyuan-glean/releases/tag/v1.3.1) 对齐。远端下载的 `package.zip` 大小与 SHA-256 均与本地一致。
- 初次 Quality gates 发现候选文档漏掉授权边界固定措辞，已补回；最终 Quality gates `37896900427` 与 CodeQL `37896900418` 均通过，真实验收边界不因此改变。
- 不提交集市 PR；真实宿主大库首屏、滚动、内存和低端设备收益继续归 B-0002/B-0005。

## 当前有效交接（2026-10-09 T-3320/D-0195 性能热点优化）

- `src/services/library-db.ts` 的大库绑定刷新已将 `existingDocIds.includes()` 改为预建 `Set` + `.has()`；保留 `existingDocIds` 返回顺序和绑定语义。10 万 ID 微基准约 7070ms→2.28ms。
- `src/ui/DockPanel.svelte` 的看板派生已改为一次筛选/排序后单遍按五态分桶，保持每列原排序和内容，减少重复映射/过滤。
- 完整门禁已通过：`pnpm check`、`pnpm test` 1226/1226、`pnpm build`、`pnpm check:release`、`pnpm perf:check`、任务账本和 `git diff --check`；本轮不升版本、不改数据契约、不打 tag/Release。真实宿主首屏、滚动、内存和低端设备验收继续归 B-0002/B-0005。

## 当前有效交接（2026-10-09 v1.3.0 发布）

`v1.3.0` 已发布。源提交 `197833f`、annotated tag 和 [GitHub Release](https://github.com/ai68298100/siyuan-glean/releases/tag/v1.3.0) 对齐；Release 附件 `package.zip` 为 377582B，本地与远端下载 SHA-256 均为 `70f5d917183bd4b1e25550b89c1ce917e8f175b09b2525a8918789c8feba0e21`。发布提交上 Quality gates `37869343819` 与 CodeQL `37869343826` 均成功；隔离 S1 E2E 58/58（本机当日实跑）。

- 本轮发布覆盖 T-3311..T-3319：设置页分类导航（T-3314）、AI 标签规范化入口（T-3311）、六轮全方位走查约 108 项修复与加固（T-3312/3313/3315/3316/3317/3318）、差距调研（`docs/RESEARCH-feature-gap-2026-10.md`，待办 T-3330..3337）。任务/决策：T-3319、D-0194。
- 本机工作树已与 `origin/main` 同步在发布提交；后续改动从 `origin/main` 快进。
- **候选工作（非执行板承诺）**：①作者真机走查（B-0002，验证设置页新导航与六轮 UI 修复的真实观感，用真实截图回填视觉矩阵 0/24）；②待办池点单驱动（建议先看 T-3330 streak、T-3331 换一篇）；③引述墙 QuotesView 接线与否的产品决策仍待作者拍板。
- 集市 PR 未授权，不执行；注意：不要把真实桌面、移动端、AI、外部服务或 pending-host 视觉案例写成已完成验收。

## 当前有效交接（2026-10-09 T-3318 保存视图持久化回归修复：精确写 API）

回归自查实证发现 T-3317 的"条目级并集合并写回"会让**已删除的保存视图复活**（删除后写回的快照不含该条目，并集把它从文件拉回——删除功能完全失效）。方案级错误无法用参数修补，已重构：

- `saveLibraryViewPrefs`（整体字段写）**已删除**，替换为四个精确写 API（`services/prefs.ts`）：`saveLastViewPref`（只写 lastView）、`upsertSavedViewPref`（幂等 upsert 单视图）、`deleteSavedViewPref`（精确删除 + 默认视图回落）、`setDefaultSavedViewPref`（只改默认）。全部在串行队列内读最新文件后定点修改，读失败抛 `UiPrefsConflictError` 拒绝写回。
- DockPanel：自动保存 effect 只同步 lastView；新建/删除/设默认由操作点精确写回（失败有提示）。`savedViews`/`defaultSavedViewId` 本地状态只用于渲染，**不再作为写回来源**。
- 回归测试改写为精确写语义（双实例互不覆盖、删除不复活、幂等覆盖、默认回落、读失败拒绝），14/14；全量 1226/1226；门禁全过。
- **教训：多实例共享的列表型数据，"并集合并"无法表达删除语义——必须用精确操作 API（增/删/改/设默认各自定点写），或引入 tombstone。**

## 当前有效交接（2026-10-09 T-3317 第五轮全方位走查：回归自查 / 次级模块 / 数据风险）

继 T-3312..3316 之后的第五轮走查。**最重要修复是两个真实数据丢失/功能失效缺陷**：

- **双 DockPanel 实例丢保存视图**（P1）：DockPanel 挂载两份（dock + 工作台 tab），自动保存 effect 用各自内存快照**整体写回** `savedViews`——在 A 画布建视图、B 画布切队列即静默丢失用户视图。新增 `services/prefs.ts` 的 `saveLibraryViewPrefs`（串行队列内读最新文件做**条目级并集**，按 id 同名以传入为准），DockPanel 改用之；加载失败时阻断自动保存（否则瞬时读取失败会把初始空快照在重试前写回清空数据）。**教训：多实例共享 saveData 字段禁止整体快照写回，必须合并写或传 expected。**
- **导入进度强制逃生不可达**（P1，T-3316 自身回归）：`discardProgress` 守卫要求 `discardConfirmed`，而损坏场景该勾选框所在区块不渲染——按钮静默无效。守卫按场景分流 + `progressReadFailed` 时强制走按文件名逃生；服务层删除前 200ms 二次校验仍读取失败才删（瞬时 busy/超时不误删健康进度）。
- 其余约 15 项（明细见 PROGRESS）：保存视图重名提示、行内操作全局忙碌互斥与提示、归档/恢复对话框按文档 ID 防叠开、ageDays 日历校验、stats/quotes 计数口径统一与 locale 归一、引导向导关窗竞态、ReadingPositionControls 着色改显式正则等。
- 回归自查确认 T-3315/3316 其余改动 20+ 项无新缺陷（keepalive、timer、取消常量、capText、QuotesView 门禁等）。
- 门禁：`pnpm check` 0/0、`pnpm test` 1225/1225（含 2 条新回归）、build、check:release、perf:check、账本、diff 全过。

## 当前有效交接（2026-10-09 T-3316 第四轮全方位走查：解析器防御 / 剩余模块 / 数据契约）

继 T-3312..3315 之后的第四轮走查，覆盖导入/解析链路的畸形输入防御、前几轮未深入的模块（收件箱恢复、归档/恢复对话框、摘录/引述视图内部）与数据契约核对。版本保持 `1.2.1`，不升版、不打 tag、不创建 Release。要点：

- **最重要发现（待作者拍板）**：`src/ui/QuotesView.svelte`（引述墙：全库引述块聚合 + 站点/标签/AI 标签/颜色/关键词筛选 + 导出/分享卡，T-1750/T-1803/T-1901 交付）**功能完整但从未接入任何视图分支**——`PanelView` 无 "quotes"，用户永远看不到。它与已接线的摘录视图（HighlightView，读库高亮聚合）数据源不同。接线与否是产品决策；内部竞态（latest-request 门禁、颜色循环 busy）已在本轮修好，随时可接。
- **解析器**：Pocket HTML 全局正则 O(n²) → indexOf 状态机（恶意输入不再冻结主线程）；四格式字段截断（title/site 512、url 8KB、标签 64×20）；时间戳年份校验；CSV 行上限；`>` 属性锚点计入 dropped。防御确认完备：原型链污染、URL 协议注入、备份校验。
- **进度文件逃生**：损坏的 `import-progress.json` 此前永久锁死导入功能（读取与丢弃同一路径）；`discardImportProgress(plugin, IMPORT_PROGRESS_FILE, true)` 强制按名删除，UI 在读取失败时显示"重置导入状态"确认入口。**传文件名字符串即走逃生路径**是新的服务层契约（tests/external-api 有覆盖）。
- **数据契约核对通过**：代码与 DATA-CONTRACT.md 的 27 个 `custom-clip-*` 键双向差集为空（铁律 1 验证脚本化可复跑）。
- 记录不修项：csvCell 三实现的 NBSP 前缀差异（无可利用面）；`processedCallback` 的 before 快照过期（最坏只是关预览）；DECISIONS 历史时序。

## 当前有效交接（2026-10-09 T-3315 第三轮全方位走查 + E2E 修复）

继 T-3312（UI 层）/T-3313（服务与入口层）之后的第三轮走查，覆盖近三轮变更自查、CSS 样式层（10485 行）、文档一致性，并**修复了 E2E 无法启动的脚本缺陷**——隔离 S1 E2E 58/58 全部通过（真实内核 3.8.6）。版本保持 `1.2.1`，不升版、不打 tag、不创建 Release。要点：

- **最重要的修复**：设置页分类切换会静默中止进行中的备份恢复/闪卡恢复/AI 标签扫描（{#if} 卸载触发 abort 且无提示）——data/maintenance 分类改为"首次访问后常驻挂载 + display 切换"（`dataVisited/maintenanceVisited` 状态），其他分类仍按需挂载。
- **E2E 修复**：`launch-e2e` 的 token 读取此前误读 `accessAuthCode`（网页访问密码，未设置为空），已改为优先 `conf.json` 的 `api.token`。注意 **`s1-flow.mjs` 是自包含 E2E**（自己起隔离内核跑完全部断言后自动退出），不需要先起 launch-e2e 守护；launch-e2e 用于交互式/桌面会话。
- 变更自查确认 20+ 疑点无新缺陷（跨分类脏检查、锁无死锁、pickDaily、currentDocId、enrich 回滚干净等）；CSS 确认暗色主题零硬编码、z-index 阶梯无冲突。
- 其余修复清单见 PROGRESS T-3315（timer 泄漏、取消常量、plans 保留、冲突兜底、空态区分、tab 方向键、44px 并入容器、CSS 死规则、D-0183 重编号、README 快捷键/CHANGELOG 链接）。
- 记录不修项：reconcile 扫描在锁外的"扫描→保存间隙"竞态（低频、下次对账自愈，注释已如实收敛）；`--glean-preview-rail-width` 双容器阈值 950/951 相邻（当前互斥成立，合并有回归风险）；DECISIONS 历史区时序排列（下次大改时顺带）。

## 当前有效交接（2026-10-09 T-3314 设置页分类导航重构）

设置页从 11 个平铺分组重构为"左导航 + 右内容"的 8 大类版式（原型先行：`design/prototype-settings.html`，桌面/窄容器两种形态截图自查后落地）。版本保持 `1.2.1`，不升版、不打 tag、不创建 Release。要点：

- **分类**：工作区 / 每日拾遗 / 阅读 / AI 增强 / AI 通道 / 集成 / 数据与恢复 / 维护。挂载看板与 CSV/诊断导出归"数据与恢复"，AI 标签规范化归"维护"。每类有一句话职责描述（`settings.desc.*`）。
- **响应式**：对话框 560×620 → 720×640；`glean-settings` 声明为 `container: glean-settings / inline-size`，≤600px 容器时导航自动降级为顶部横向滚动 tab（组件 scoped `@container` 查询，断言在 header-actions/accessibility 测试里）。注意 `.glean-settings` 的滚动职责已移交给 `.glean-settings__content`（组件内覆盖 `overflow: hidden`；index.scss 的 `overflow-y: auto` 保留给非本组件场景，勿"清理"）。
- **锚点笔记本筛选**：搜索框（名称子串、大小写不敏感）+ 已选 n/total 计数 + 一键清空 + 过滤空态；新手提示条移入工作区分类顶部。
- **视觉验证方法**：`pnpm build && node scripts/preview-settings.mjs output/playwright/xxx.html` 生成 SSR fixture（含组件 scoped CSS），浏览器打开截图。脚本是通用工具，后续 UI 轮可复用。
- i18n 双语各 1026 键一致（新增 21 键）；`pnpm check` 0/0、`pnpm test` 1223/1223、build/release/账本/diff 门禁全过。真实浮窗密度/暗色/触控归 B-0002。

## 当前有效交接（2026-10-09 T-3313 第二轮全方位走查：服务层/域层/API/主入口）

继 T-3312（UI 组件层）之后的第二轮系统性走查，覆盖上次未深入的服务层（37 文件）、域层纯函数、`src/api/` 端点层与 `src/index.ts` 主入口。修复约 30 项，未新增端点或文章属性，版本保持 `1.2.1`，不升版、不打 tag、不创建 Release。要点：

- **功能级 bug**：`pickDaily`（domain/resurface.ts）有两个算法缺陷——置顶项以 `MAX_SAFE_INTEGER` 作贪心比较基准，只要有"今日置顶"，每日拾遗就坍缩为只剩置顶（"读完并下一篇"也永远返回置顶）；-2 淘汰规则误伤分数天然低但无标签重叠的候选。两者已修并补回归。滑动背景的动作标签 CSS 左右放反（右滑显示"归档"实际执行"改天"），已对齐 `resolveSurfaceSwipe`。
- **主入口**：`currentDocId()` 原来取布局序第一个编辑器——多编辑器/分屏时 `markDone`/收录/富化可能写错文档，现改为选区→焦点→布局序三级锚定；补基类 `openSetting()` 覆盖（此前思源"设置→插件"齿轮点击静默无反应）；`⌥⌘G` 双重注册只保留命令；`kernelPost` 的 fetchSyncPost 回退分支补超时与 failCallback，`KERNEL_TIMEOUT_LONG_MS` 接线到 exportMdContent/exportHTML/putFile 三个长操作。
- **服务层**：`writeClip`/`reconcileIndex`/`scanPreview`/`rebuildIndex` 的索引读改写全部包进 `withIndexLock`（此前并发增量写会丢、对账期间一次属性写可用旧快照覆盖整份新索引）；导入文件加 32MiB 上限（`import.progress.error.size`）；迁移 URL 裁决合并单次 patch；删除 weeklyReport 死代码链（`buildWeeklyReportMarkdown`/`weeklyReportDocPath`/`exportWeeklyReport` 及测试）。
- **重要教训（代理误报甄别）**：审查代理报告 `uncertainUsage`（计量未知暂停 AI）与 author 非法 ID `reason:"changed"` 为"死锁/语义缺陷"，但两者的行为均有既有测试明确锁定（"计量未知不得继续调用"、"非法ID→changed"），属于**有意的设计契约**——保守暂停 + UI 文案引导重载。本轮曾尝试"修复"后被测试拦下，已回滚。后续改动这两个语义前必须先改契约和测试。
- **i18n**：新增审计脚本 `scripts/audit-dead-i18n.mjs`（字面量+动态模板前缀双向核对），清理 30 个死键（旧 stats.* 周报族、migrate.column* 族、board.mounted 等），双语各 1005 键一致；新增 `import.progress.error.size`。
- 门禁：`pnpm check` 0/0、`pnpm test` 1222/1222、`pnpm build`、`pnpm check:release`、任务账本、`git diff --check` 全通过。**隔离 S1 E2E 本轮未跑**：`launch-e2e` 读到工作区 `~/SiYuan-Glean-E2E/conf/conf.json` 的 `accessAuthCode` 为空（上次会话残留），需 `--token`/`SIYUAN_TOKEN` 或重建隔离工作区；不属于代码门禁失败。
- 记录不修项（同 T-3312 口径）：migrate-service 全面加锁（UI 已有重入 guard，双实例并发低频，需专门任务）、bridge.listClips 全量对账性能、bindClipsToLibrary 批失败粒度、inbox 云端时区语义、三个零引用服务文件（services/tts.ts、reading-time.ts、reading-position.ts，仅测试引用，删除需连测试一起处理）。

## 当前有效交接（2026-10-09 T-3312 全方位走查找缺修复）

本轮对全部 UI 组件、文案与服务层做了一轮系统性走查（4 个并行审查 + 逐项人工验证），修复约 30 项确定性问题，未新增端点或文章属性，版本保持 `1.2.1`，不升版、不打 tag、不创建 Release。要点：

- **阅读链路**：切文清空朗读分段（此前"继续朗读"会读出上一篇）；`loadContext` 失败保留会话阅读计时（计时条件含 `context` 非空，错误态自动暂停，安全）；外观工具栏按钮改为真正的开合；protyle-controller 迟到 ready 不再对已销毁实例二次 destroy（`tests/workbench-preview.test.ts` 断言已同步并新增新实例清理覆盖）。
- **工作台**：Dock/Tab 空态统一——筛选无结果用新键 `library.noMatch` 并提供清除筛选，删掉了抑制空态的 `candidateCount > 0 && activeQueue === "inbox"` 特判（候选本就在 `rows` 里，该特判只会造成空白）；候选行四个操作用 `candidateBusyId` 互斥防重复提交。
- **弹窗**：迁移 `resume`/`startRun`/`startScan` 均有重入 guard（此前双击"继续回填"会并发两条 `runBackfillBatch` 循环读写同一进度文件）；备份选择文件后清空 `input.value`（同文件可重选）、预览取消（`"Backup preview cancelled"`）静默处理；导入恢复/重试按钮 disabled 条件补齐 `notebookLoading/notebookError`。
- **设置**：`save()` 传 `expected: originalSettings`，捕获 `SettingsConflictError` 后从磁盘刷新 `facade.settings` 与基准、保留用户草稿再提示（新键 `settings.conflict`）——多窗口并发保存不再整体覆盖；T-3311 遗留的笔记本/打卡/AI 日志加载错误+重试已随未提交工作树一并收尾验证。
- **i18n**：zh/en 各 1034 键一致；新增 9 键、修正约 25 处表述（明细见 PROGRESS T-3312）。审查发现约 40 个"死键"（无代码引用，如旧 `stats.title` 族、`settings.aiEnrichOnCapture`）本轮未清理，避免无关 diff；后续可单独做键清理任务。
- 门禁：`pnpm check` 0/0、`pnpm test` 1221/1221、`pnpm build`、`pnpm check:release`、任务账本、`git diff --check` 全通过。交互修复的真实三画布/移动端走查继续归 B-0002；审查中判定"不修"的项：今日拾遗"吃灰 N 天"徽标阈值 14 天为轻量展示口径（与超龄治理 `staleDays` 语义不同，联动会让徽标基本消失）、`excerpt-service` 中文导出目录名（改目录影响既有用户数据一致性，仅文案层面说明）。

## 当前有效交接（2026-10-09 AI 标签规范化入口）

设置页现在提供“AI 标签规范化”：用户点击扫描后查看相似标签组，逐组选定保留名称，再显式合并；成功后重新扫描并广播数据变更。实现文件为 `src/ui/AiTagMergePanel.svelte`、`src/ui/SettingsView.svelte`、双语 i18n 和 `src/services/ai-tag-service.ts` 的输入保护；任务 T-3311，决策 D-0192。当前工作树后续必须保持版本 `1.2.1`，本轮不升版、不打 tag、不创建 Release。

- 自动化回归已加入 AI 标签面板 SSR 首屏测试；作者存量 109 篇微信公众号的批量作者回填仍未实现，继续按 T-1813 逐篇授权边界推进。
- 真实设置浮窗、大库标签质量、真实模型和 24 个 pending-host 视觉案例仍需 B-0002/B-0004 等作者环境证据；不要把本轮服务/组件测试写成真机验收。

## 当前有效交接（2026-10-08 v1.2.1 发布）

`v1.2.1` 已发布。源提交 `2c82a44`、annotated tag 和 GitHub Release 对齐；Release 附件 `package.zip` SHA-256 为 `8eb5d37622cf355f6dfd297ef27956cef92250d015b7f159988861ae759b3346`。发布提交的 Quality gates 与 CodeQL 均成功，隔离 S1 E2E 58/58；本次发布记录已补齐。集市 PR、历史发布、保留分支和真实宿主验收边界不变。

- 任务/决策：T-3310、D-0191。
- 注意：不要把真实桌面、移动端、AI、外部服务或 pending-host 视觉案例写成已完成验收。

## 当前有效交接（2026-10-08 README 更新摘要约定）

中英文 README 已在安装说明前增加“本次更新 / Latest update”区块，按“新增 / 优化 / 修复”分组列出当前 main 的用户可见变化；本轮内容标明基于 v1.2.0，避免把 main 后续修复误写成已包含在 Release 附件中。D-0190 与 T-3309 已记录，后续每轮用户可见更新都要同步维护两份 README，并遵守能力矩阵的真实验收边界。

- 改动：`README.md`、`README.en-US.md`、`docs/DECISIONS.md`、`TODO.md`、`docs/PROGRESS.md`、`docs/TASK-LEDGER.md`。
- 本轮不升版本、不打 tag、不创建 Release；工作区门禁需在提交前复跑。

## 当前有效交接（2026-10-08 设置浮窗宽度修复）

设置浮窗截图中的逐字换行和按钮挤压是共享弹窗内容区交叉轴没有被宿主主题明确拉伸造成的。本轮将 `dialog-content` 明确设为 `align-items: stretch`，并让 `.glean-settings` 以 `width: 100%`、`min-width: 0` 和 `box-sizing: border-box` 铺满内容区；设置容器查询只会在真实窄宽度下触发。

- 改动：`src/libs/dialog.ts`、`src/index.scss`、`tests/header-actions.test.ts`；任务 T-3308，决策 D-0189。
- 门禁与 PR 尚未完成；版本继续为 v1.2.0，不升版、不打 tag、不创建 Release。真实设置浮窗分组、滚动和底部操作区仍需 B-0002。

## 当前有效交接（2026-10-08 独立浮窗工作台宽度修复）

独立浮窗截图中的中文竖排和按钮挤压来自弹窗内容区的 flex 方向与尺寸约束：`svelteDialog` 原本让 `dialog-content` 使用默认横向 flex，`display: contents` 挂载下的 `.glean-panel` 按最小内容宽度收缩，触发 `glean-workbench` 窄容器规则。本轮把内容区改为纵向 flex，设置 `width: 100%`、`min-width/min-height: 0` 和 `box-sizing: border-box`，让工作台根节点沿横轴铺满浮窗。

- 改动：`src/libs/dialog.ts`、`tests/header-actions.test.ts`；任务 T-3307，决策 D-0188。
- 门禁与 PR 尚未完成；版本继续为 v1.2.0，不升版、不打 tag、不创建 Release。真实独立浮窗排版、滚动和关闭行为仍需 B-0002。

## 当前有效交接（2026-10-08 宽画布今日拾遗卡片排版修复）

用户截图反馈第二张今日拾遗卡片底部出现灰色露底、阴影不齐。根因是宽屏 CSS Grid 的行高拉伸了 `glean-surf-swipe` 包装层，绝对定位滑动背景层覆盖到短内容卡片之外。当前修复在宽屏将包装层设为 flex，卡片纵向填满网格行，操作区贴底；窄 Dock/移动端不改变。

- 改动：`src/index.scss` 宽屏 `@container glean-workbench` 卡片布局；`tests/header-actions.test.ts` 增加结构回归。
- 任务：T-3306；决策：D-0187；真实宽画布三卡底线、阴影和多标题观感仍需作者按 B-0002 走查。

## 当前有效交接（2026-10-08 GitHub 内容与分支收口）

README 中英文已恢复独立的小驴系列插件说明和 QQ 群 `871707735`，雷切入口使用当前有效的 `siyuan-speed-switch`；版本继续为 v1.2.0，本轮没有新的产品功能，不升版、不重发 Release。GitHub 当前无开放 PR，历史 PR/Release/tag 保留审计链；main 保护只保留 `quality` 必过，禁止强推和删除。

- `main`/`origin/main` 当前为 `3007b84`，本机工作树应继续从 `origin/main` 快进同步。
- `codex/main-sync-20261008` 必须保留并继续指向 `c6b37a8`；`dev/thispc-1002` 已被 main 完整包含且无独有提交，已按作者授权删除。
- PR #11 已合并，Quality gates 与 CodeQL 均通过；本轮文档门禁完成，GitHub 远端只保留 main 和指定的 main-sync 分支。

## 当前有效交接（2026-10-08 README/GitHub 首页整理）

中英文 README 已按用户上手顺序收敛，包含 Latest Release 安装、候选确认主流程、属性数据主权、AI 隐私和真实验收边界；删除过时的 T-1713/T-1718 内部待办表述。Issue 模板改为填写实际安装版本。GitHub About、主页、主题、main 默认分支、v1.2.0 Latest Release 和开放 Issue/PR 已核对，无需改动或清理历史记录；真实宿主截图仍待 B-0002。

- 本轮范围：README 双语、Issue 模板、T-3290、D-0184、进度/交接和任务账本。
- 验证：`pnpm check`（0 错误/0 警告）、`pnpm test`（1214/1214）、任务账本、README 本地链接和 `git diff --check` 均通过；通过 PR 更新 GitHub main，CI 继续运行构建、性能、视觉登记和发布门禁。

## 当前有效交接（2026-10-08 v1.2.0 发布收口）

本轮将两台开发机已合入 `main` 的结果定版为 `v1.2.0`。GitHub 默认分支、稳定 Release 和后续机器同步源统一为 `main`；本机后续只从 `origin/main` 快进同步，`dev/thispc-1002` 保留为历史开发分支，不再作为发布源。制卡 E2E 恢复缺陷已修复，独立 S1 通过 58/58 条断言，其中恢复路径 10 条；真实桌面、移动、AI、外部服务和视觉矩阵仍需作者按 blockers 验收。

- 版本文件、README、CHANGELOG、发布候选和主线协议已同步到 v1.2.0。
- 已收尾：发布门禁通过，版本提交 `faf046c` 已推送；`v1.2.0` tag 和 [GitHub Release](https://github.com/ai68298100/siyuan-glean/releases/tag/v1.2.0) 已创建，附件 `package.zip` 与本地 SHA-256 一致，GitHub 默认分支已切为 `main`。其他机器后续按 `origin/main` 快进同步。
- 集市 PR 仍未授权，不执行；不修改或删除 `codex/main-sync-20261008`。

## 当前有效交接（2026-10-08 T-3303/D-0182）

移动今日拾遗快捷动作首项已修正为“收录”：按钮通过父级 `quickCapture` 回调调用 `GleanFacade.addCurrentDocToLibrary()`，复用当前文档手动收录链路；Pocket/Omnivore/wallabag 外部导入仍位于更多菜单。按钮保持 44px 命中区，并复用父级忙碌态防重复点击；DOM 顺序调整为主卡片或空态先于“快捷动作”标题和按钮。

- 本轮改动：`src/ui/ResurfaceView.svelte`、`src/ui/DockPanel.svelte`、中英文 i18n、`tests/header-actions.test.ts` 及任务/决策/进度文档。
- 已通过定向 UI/i18n 回归、全量 `pnpm test` 1174/1174、`pnpm check`、`pnpm build`、`pnpm perf:check`、`pnpm task:ledger -- --check` 与 `pnpm check:release`；`pnpm visual:check` 保留 24 个 pending-host。版本保持 `1.1.0`，不触碰 `main`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-08 T-3302/D-0181）

宽画布工作台与独立浮窗的首页/图书馆头部已补齐原型主收录动作：首页显示“快速收录”，图书馆显示“收录”。按钮只调用 `GleanFacade.addCurrentDocToLibrary()`，复用现有 `captureDocument(src: "manual")`、冲突提示、自动富化和数据变更通知；Dock/移动端不增加窄顶栏按钮。

- 本轮改动：`src/types.ts`、`src/ui/DockPanel.svelte`、`src/index.scss`、中英文 i18n、`tests/header-actions.test.ts` 及任务/决策/进度文档。
- 已通过：定向 UI/i18n 回归、全量 `pnpm test` 1174/1174、`pnpm check`、`pnpm build`、`pnpm perf:check`、`pnpm task:ledger -- --check`、`pnpm check:release`；视觉矩阵仍有 24 个 pending-host。真实工作台宽度、独立浮窗、多编辑器当前文档语义仍待 B-0002。版本保持 `1.1.0`，不触碰 `main`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-08 T-3301/D-0180）

移动端今日拾遗首屏已补齐原型的三个快捷动作：导入、搜索、候选。导入调用既有导入弹层；搜索由 Dock 父级清除旧筛选后进入全库搜索；候选由既有 `openCandidateQueue` 进入收件箱队列。按钮保持 44px 命中区，未新增数据字段或端点。

- 本轮改动：`src/ui/ResurfaceView.svelte`、`src/ui/DockPanel.svelte`、`src/index.scss`、中英文 i18n、`tests/header-actions.test.ts` 及任务/决策/进度文档。
- 已通过：定向 UI/i18n 回归、`pnpm check`；真实 Android 安全区、触控误触和导入弹层仍待 B-0002。版本保持 `1.1.0`，不触碰 `main`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-08 T-3292/D-0179）

窄 Dock 搜索现在有完整的可逆交互：打开后自动聚焦，输入关键词时可清空；关闭按钮和 Escape 都会收起输入框，并将焦点还给搜索图标。关闭不清除关键词，回到图书馆时筛选结果保持不变；工作台/浮窗常驻搜索不显示关闭动作。

- 本轮改动：`src/ui/DockPanel.svelte`、`src/index.scss`、`public/i18n/zh_CN.json`、`public/i18n/en_US.json`、`tests/accessibility.test.ts` 及任务/决策/进度文档。
- 已通过：定向无障碍回归、`pnpm check`（0 错误/0 警告）、`pnpm test`（1172/1172）。真实 Dock 宽度、键盘和移动触控仍待 B-0002；版本保持 `1.1.0`，不触碰 `main`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-07 T-3300/D-0178）

收集箱迁入已接入 `inbox-recovery.json`：创建前保存 intent，拿到合法文档 ID 后保存 `capture-pending`，收录后保存 `remove-pending`；capture/index 失败复用精确 ID，创建响应未知进入 unknown 并禁止重建。检查点只保存阶段、oId、目标位置和文档 ID，不保存正文或文章属性。

- 新增 `src/domain/inbox-recovery.ts`、`src/services/inbox-recovery.ts` 和 `tests/inbox-recovery.test.ts`；`tests/external-api.test.mjs` 增加恢复重试与未知创建回归，`package.json` 已纳入测试命令。
- 收集箱/检查点定向回归 42/42，`pnpm check`（0 错误/0 警告）、`pnpm test`（1172/1172）、`pnpm build`、`pnpm check:release`、`pnpm task:ledger -- --check` 与 `git diff --check` 已通过；`pnpm visual:check` 的 24 个案例仍等待真实宿主截图。真实收集箱、插件重载、双窗口和云端删除仍待 B-0002/B-0007。
- `docs/INTEGRATION-ACCEPTANCE.md` 与 `docs/BLOCKERS.md` 已补充 T-3300 的真实验收记录：重载后阶段/确切 docId、unknown 禁止重建、云删除失败重试和双窗口 busy 结果；下一台机器可直接按 INT-02/INT-F05 执行。
- 当前开发分支为 `dev/thispc-1002`，不触碰 `main`，不升版、不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-07 T-3299/D-0177）

收集箱和外部文件的标题、描述、站点名与标签按纯文本语义写入 Markdown；跨行描述逐行保持引用，来源链接限制为 HTTP(S)。云端 `shorthandMd` 正文不做改写；本轮未新增存储、属性或 API。

- 改动涉及 `src/services/inbox-service.ts`、`src/services/import-service.ts`、相应服务回归、`TODO.md`、`docs/TASK-LEDGER.md`、`docs/DECISIONS.md`、`docs/PROGRESS.md` 与本页。
- 收集箱/导入定向回归 52/52；`pnpm check` 0 错误/0 警告，`pnpm test` 1166/1166，`pnpm build`、发布门禁、任务账本和差异检查通过。视觉矩阵 24 项仍需真实宿主截图，不视为本地失败。
- 提交 `91b4ecb` 已推送到 `dev/thispc-1002`；GitHub Quality gates `37634094181` 和 CodeQL `37634094243` 均成功，当前开放 CodeQL 告警 0。版本保持 `1.1.0`，不触碰 `main`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-07 T-3298/D-0176）

README 中英文将生态入口改为明确的精选列表，不再声称小驴系列总共只有四款；链接已核对到公开仓库。并回填前两轮验证：T-3296 的 Quality gates/CodeQL 运行 `37621180944`/`37621181033` 均成功；T-3297 的运行 `37627913882`/`37627914365` 均成功。

- T-3298 文档事实与本地链接、任务台账检查通过；没有改变插件行为或发布策略。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-07 T-3297/D-0175）

阅读帮助弹窗已改为 DOM 节点 + `textContent`，并使用 `glean-reader-help` 前缀样式和主题令牌，避免翻译文案进入 `innerHTML`。中英文 README 已同步开发分支稳定性说明、Node.js/pnpm 前置版本，并修正小驴雷切仓库链接；`docs/media/demo.gif` 仍按发布媒体清单等待作者真机素材，不视为断链故障。

- T-3297 本地 `pnpm check`、`pnpm test` 1164/1164、构建、视觉登记、发布门禁和任务账本均通过；GitHub Quality gates `37627913882`、CodeQL `37627914365` 均成功。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-07 T-3296/D-0174）

CodeQL push 触发器已补齐 `codex/**`，与 Quality gates 的 `main`、`dev/**`、`codex/**` 范围一致；临时开发分支也会执行安全扫描。该配置不改变版本、主干、Release 或集市策略。

- T-3296 已通过 workflow YAML 解析、任务账本和差异检查；GitHub Quality gates `37621180944`、CodeQL `37621181033` 均成功。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-07 T-3294/D-0172）

CodeQL 发现 Pocket HTML 导入标题清理和 Markdown 注释闭合的生产告警，本轮已修复输入边界并补回归；固定测试 URL 断言已独立核验无敏感 sink，保留断言并按 `used in tests` 分类关闭。详细状态见 TODO 的 T-3294/T-3295。

- T-3294 已通过导入/格式化定向 61/61、全量 `pnpm test` 1163/1163、`pnpm check`、`pnpm build`、性能/视觉/发布门禁，CodeQL #1/#2 已标记 fixed。
- T-3295 已确认 #3/#4 为隔离 Spike 固定导出断言、#5/#6 为测试结果断言，四条均无敏感 sink，保留原断言并按 `used in tests` 关闭；不得通过放宽或删除断言绕过 CodeQL。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-07 T-3288/D-0171）

本轮补齐用户反馈闭环：新增 `docs/FEEDBACK-LOOP.md`，明确问题发现、诊断、修复、验证和关闭的记录字段；问题模板补充文章载体、首次出现版本、重试结果和能力/恢复矩阵链接；功能建议、使用问题、CONTRIBUTING 与 PR 模板统一链接该规范。未改变插件功能、数据契约或发布策略。

- 本轮验证：模板字段与链接静态核对、`pnpm task:ledger -- --check`、`git diff --check` 通过；真实使用反馈仍待作者走查。
- T-3288 当前为“代码与文档已补齐、流程真实使用待验证”；不要把模板存在当成反馈闭环已经在真实 Issue 中跑通。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-07 T-3290/D-0170）

中英文 README 顶部新增 CodeQL 工作流徽章，与现有 Quality gates 和 Latest Release 徽章并列，方便查看 CI、安全扫描及稳定发布状态。徽章不代表真实宿主、移动端或外部集成已验收；T-3290 仍等待作者审阅真实截图和合并前发布口径。

- 本轮改动：`README.md`、`README.en-US.md`、`TODO.md`、`docs/TASK-LEDGER.md`、`docs/DECISIONS.md`、`docs/HANDOFF.md`。
- 本地验证：README 中英文入口与 CodeQL workflow 文件路径一致，任务账本和差异格式检查通过。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-07 T-3284/D-0169）

本轮把既有合成性能基线接入 GitHub Quality gates，在 1k/5k/10k 数据规模上检查扫描、索引重建、筛选、导入解析和今日拾遗的中位耗时，并继续检查分页、属性批次与结果规模约束。它只负责发现生产纯函数的明显退化，不把 Node 合成耗时当作真实思源宿主、移动设备或外部文件的性能承诺。

- 本轮改动：`.github/workflows/ci.yml`、`TODO.md`、`docs/TASK-LEDGER.md`、`docs/DECISIONS.md`、`docs/HANDOFF.md`。
- 本地验证：`pnpm check`（0 错误/0 警告）、`pnpm test`（1160/1160）、`pnpm build`、`pnpm perf:check`、`pnpm task:ledger -- --check`、`pnpm visual:check`（24 个案例仍待真实宿主）、`pnpm check:release` 和 `git diff --check` 均通过。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 `package.zip`；真实大库体验仍归 T-3284/B-0002/B-0005。

## 当前有效交接（2026-10-07 T-3290/D-0168）

本轮将任务账本一致性检查加入 GitHub Quality gates：CI 在代码质量、测试、构建后执行 `pnpm task:ledger -- --check`，防止 `TODO.md` 执行板与生成账本漂移；同步刷新 T-3290 的账本描述和 D-0168 决策。没有改变插件功能、数据契约或版本。

- 本轮改动：`.github/workflows/ci.yml`、`docs/TASK-LEDGER.md`、`docs/DECISIONS.md`、`docs/HANDOFF.md`。
- 本地验证：`pnpm task:ledger -- --check`、`pnpm visual:check`（24 个案例均登记为 pending-host）、`pnpm check`（0 错误/0 警告）、`pnpm test`（1160/1160）、`pnpm build`、`pnpm check:release`、`git diff --check` 均通过。
- CI 实现提交 `cfac3dc` 已推送到 `dev/thispc-1002`；该提交的 Quality gates 和 CodeQL 均成功。本轮未触碰 `main`，没有升版、打 tag、发 Release 或提交集市。
- 下一步先完成 T-3275–T-3278 的作者真实宿主/真机验收；T-3279–T-3286 依赖真实截图、设备、模型或外部数据，按各自 blocker 留待实测；T-3287–T-3289 等主链反馈与作者品牌素材审阅。T-3292/3293 的代码与隔离验证已完成，分别等待 B-0002/B-0012；T-3290 等作者审阅真实截图与合并前发布口径；T-3291 等真实安装检查与明确发布授权。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-07 T-3236/D-0167）

本轮补齐工作台批量操作的原型归属：列表行和看板卡直接提供选择入口，各自内容区显示共享批量条；预览侧栏不被根级浮动条覆盖。批量状态、归档、AI 批处理和清空动作继续复用既有 Dock 逻辑，未改变数据契约。

- 当前改动文件：`src/ui/LibraryBatchBar.svelte`、`src/ui/DockPanel.svelte`、`src/index.scss`、`tests/header-actions.test.ts`、`tests/recovery.test.ts`、`docs/DECISIONS.md`、`docs/PROGRESS.md`、`docs/HANDOFF.md`。
- 本轮静态回归、类型检查（0 错误/0 警告）、全量测试（1160/1160）、生产构建、任务台账、视觉矩阵和 `git diff --check` 均通过；真实 Dock 宽度、看板密度和移动触控仍归 B-0002，视觉矩阵仍有 24 个 `pending-host`。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-07 T-3283/D-0166）

本轮将低频朗读控件移入阅读页签既有“辅助工具”折叠区；摘录与 AI 仍在伴生栏主层，切文时继续由原有状态收起。未改变 speechSynthesis 会话、正文宿主或数据契约。

- 当前改动文件：`src/ui/ReaderTab.svelte`、`src/index.scss`、`tests/reader-acceptance.test.ts`、`docs/DECISIONS.md`、`docs/PROGRESS.md`、`docs/HANDOFF.md`。
- 已通过：定向阅读/i18n/无障碍 29/29；全量 `pnpm test` 1159/1159；`pnpm run check` 0 错误/0 警告；生产构建、任务台账、视觉矩阵和 `git diff --check` 通过。真实宿主、系统语音和 Android 仍归 B-0002，视觉矩阵仍有 24 个 `pending-host`。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-07 T-3283/D-0165）

本轮继续按原型收口原生阅读上下文的标题层级：文章标题提升为 13px/700，来源、载体和状态继续保持较小元数据层级，长标题仍单行省略。未改变正文、文章属性、索引、端点或写入契约。

- 当前改动文件：`src/index.scss`、`tests/reader-acceptance.test.ts`、`docs/DECISIONS.md`、`docs/PROGRESS.md`、`docs/HANDOFF.md`。
- 本轮新增静态回归待验证；真实宿主与 Android 仍归 B-0002，视觉矩阵仍有 24 个 `pending-host`。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-07 T-3283/D-0164）

本轮继续收口阅读失败恢复：Protyle 失败时若正文宿主曾获焦，焦点转移到重试按钮；异步失败不会抢走原本在工具栏等处的焦点。原生阅读上下文在窄屏横向动作轨道中保持状态动作组完整宽度，避免按钮内部折行。未改变正文、文章属性、索引、端点或写入契约。

- 当前改动文件：`src/ui/ProtyleHost.svelte`、`src/ui/ReadingContext.svelte`、`src/index.scss`、`tests/reader-acceptance.test.ts`、`docs/DECISIONS.md`、`docs/PROGRESS.md`、`docs/HANDOFF.md`。
- 已通过：定向阅读/i18n/无障碍/焦点 27/27；全量 `pnpm test` 1157/1157；`pnpm run check` 0 错误/0 警告；生产构建、任务台账和视觉矩阵检查通过。真实宿主与 Android 仍归 B-0002；视觉矩阵仍有 24 个 `pending-host`。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-07 T-3283/D-0163）

本轮补齐原生阅读上下文读取失败态：`readClipContext` 异常时显示主题错误表面、双语失败说明和可重试按钮；成功返回 `null` 仍表示非剪藏并保持静默。未改变正文、文章属性、索引、端点或写入契约。

- 当前改动文件：`src/ui/ReadingContext.svelte`、`src/index.scss`、`public/i18n/zh_CN.json`、`public/i18n/en_US.json`、`tests/reader-acceptance.test.ts`、`docs/DECISIONS.md`、`docs/PROGRESS.md`、`docs/HANDOFF.md`。
- 已通过：定向阅读/i18n/无障碍 25/25；全量 `pnpm test` 1155/1155；`pnpm run check` 0 错误/0 警告；生产构建、任务台账和视觉矩阵检查通过。真实宿主、多窗口、三画布与 Android 触控仍归 B-0002；视觉矩阵仍有 24 个 `pending-host`。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-07 T-3283/D-0162）

本轮补齐原生阅读上下文的切文隔离：切换 `docId` 时清空旧上下文、进入加载态并收起“维护与增强”；新文档如果正文缺失，状态 effect 仍会自动展开维护区。未改变正文、文章属性、索引、端点或写入契约。

- 当前改动文件：`src/ui/ReadingContext.svelte`、`tests/reader-acceptance.test.ts`、`docs/DECISIONS.md`、`docs/PROGRESS.md`、`docs/HANDOFF.md`。
- 真实 Protyle、多窗口、三画布与 Android 触控仍归 B-0002；视觉矩阵仍有 24 个 `pending-host`。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-07 T-3283/D-0161）

本轮继续做阅读舒适度收口：ReaderTab 切文时重置“辅助工具”和“阅读外观”的展开状态，避免低频面板跨文档残留；统计页 30 日趋势在窄视口和窄工作台容器中降低柱间距与最小宽度，并保留横向滚动兜底。未改变统计口径、文章属性、索引、端点或写入契约。

- 当前改动文件：`src/ui/ReaderTab.svelte`、`src/index.scss`、`tests/reader-acceptance.test.ts`、`tests/header-actions.test.ts`、`docs/DECISIONS.md`、`docs/PROGRESS.md`、`docs/HANDOFF.md`。
- 已通过：定向 UI/i18n/无障碍 37/37；全量 `pnpm test` 1154/1154；`pnpm run check` 0 错误/0 警告；生产构建、任务台账和视觉矩阵检查通过。真实宿主与 Android 验收仍归 B-0002，视觉矩阵仍有 24 个 `pending-host`。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-07 T-3260/D-0160）

本轮继续按原型收紧原生编辑器阅读上下文：来源、状态和返回读库保持主动作条；正文检测和排版优化放入默认关闭的“维护与增强”折叠区。正文缺失时维护区自动展开，缺失提示与重新剪藏动作仍直接可见；移动端折叠标题沿用 44px 命中区。未移除能力，也未改变正文、文章属性、索引、端点或写入契约。

- 当前改动文件：`src/ui/ReadingContext.svelte`、`src/index.scss`、`public/i18n/zh_CN.json`、`public/i18n/en_US.json`、`tests/reader-acceptance.test.ts`、`docs/DECISIONS.md`、`docs/PROGRESS.md`、`docs/HANDOFF.md`。
- 已通过：`pnpm test` 1153/1153；`pnpm run check` 0 错误/0 警告；`git diff --check` 通过。视觉矩阵仍为 24 个 `pending-host`，没有新增真实思源宿主或 Android 真机证据。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-07 T-3260/D-0159）

第三十六轮修正回顾趋势的真实时间范围，并按原型收紧阅读伴生栏首屏：`aggregateReadingReview` 新增 `recentCompletionTrend`，以参考日为终点生成最多 30 个本地日历日，跨月/跨年补零，完成计数不超过参考日；`StatsView` 只消费该序列，年度热力图继续用于全年分析。`ReaderTab` 将状态动作和优先级评分提前，最近阅读、作者编辑、阅读位置、外观和大纲包入默认关闭的“辅助工具”；桌面外观入口会先展开辅助工具再打开外观。`ReadingPositionControls` 改为接收实例 ID 并生成稳定标题关联，避免多实例重复 ID。

- 当前改动文件：`src/domain/stats.ts`、`src/ui/StatsView.svelte`、`src/ui/ReaderTab.svelte`、`src/ui/ReadingPositionControls.svelte`、`src/index.scss`、`public/i18n/zh_CN.json`、`public/i18n/en_US.json`、`tests/stats.test.ts`、`docs/DECISIONS.md`、`docs/PROGRESS.md`、`docs/HANDOFF.md`。
- 已通过：`pnpm test` 1152/1152；`pnpm run check` 0 错误/0 警告；`pnpm build`、`pnpm task:ledger -- --check`、`pnpm visual:check`、`git diff --check` 通过。
- 当前视觉矩阵仍为 24 个 `pending-host`，本轮未新增真实思源宿主或 Android 真机截图；不要把本地组件截图当作宿主验收证据。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 `package.zip`。

## 当前有效交接（2026-10-07 T-3260/D-0158）

第三十五轮恢复原型首屏动作并降低增量信息噪声：阅读桌面顶栏提供阅读外观与打开原文，外观按钮直接打开伴生栏折叠区；窄屏隐藏桌面动作，保持正文首屏高度。伴生栏标题改为“伴生栏”，统计快照移入统计口径详情、完成文章列表默认折叠，趋势零值柱降低存在感；摘录 scope active 恢复轻量胶囊，卡片 hover 限定在支持悬浮的设备。未新增功能，未改变业务、数据、文章属性、索引、端点或设置语义。

- 当前改动文件：`src/index.scss`、`src/ui/ReaderTab.svelte`、`src/ui/StatsView.svelte`、`public/i18n/zh_CN.json`、`public/i18n/en_US.json`、`tests/accessibility.test.ts`、`tests/header-actions.test.ts`、`tests/reader-acceptance.test.ts`、`docs/DECISIONS.md`、`docs/PROGRESS.md`、`docs/HANDOFF.md`。
- 截图基线仍为 `output/playwright/round34-stats-desktop.png`、`output/playwright/round34-stats-mobile.png`；本轮未新增宿主截图，非真实思源内核运行或 Android 真机验收。
- 已通过：`pnpm run check` 0 错误/0 警告；定向 UI/i18n/阅读回归 35/35；`pnpm test` 1151/1151；`pnpm build`、`pnpm task:ledger -- --check`、`pnpm visual:check`、`git diff --check` 通过。视觉矩阵仍为 24 个 pending-host，未冒充真实宿主截图。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

## 既往交接（2026-10-07 T-3260/D-0157）

第三十四轮继续按原型收口动作发现与阅读伴生区密度：统计总览首屏承载已有报告动作，趋势增加起止日期，指标提示改为合法描述列表项；阅读外观与大纲默认折叠，摘录读屏标签带跨页连续序号和摘要；阅读伴生栏标题按组件实例生成唯一 ID。此轮只调整 UI、CSS、测试和可访问表达，没有新增功能或改变业务、数据、文章属性、索引、端点、设置语义。

- 当前改动文件：`src/index.scss`、`src/ui/HighlightView.svelte`、`src/ui/ReaderTab.svelte`、`src/ui/ReadingContext.svelte`、`src/ui/StatsView.svelte`、`tests/accessibility.test.ts`、`docs/DECISIONS.md`、`docs/PROGRESS.md`、`docs/HANDOFF.md`。
- 截图基线：`output/playwright/round34-stats-desktop.png`、`output/playwright/round34-stats-mobile.png`；为本地组件预览，非真实思源内核运行或 Android 真机验收。本轮未新增宿主截图。
- 已通过：`pnpm run check` 0 错误/0 警告；定向 UI/i18n/可访问性 31/31；全量 `pnpm test` 1150/1150。
- 提交前继续执行 `pnpm build`、`pnpm task:ledger -- --check`、`git diff --check`。版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

## 既往交接（2026-10-07 T-3260/D-0156）

第三十三轮按原型重排统计主路径并补实例语义：统计首屏三张指标卡增加辅助说明，主活动区改为过去 30 天趋势，全年热力图、逐日表和四组分布收进可展开分析；摘录标题、排序方向和清除筛选状态补齐；阅读页侧栏、快捷键、章节和语速控件 ID 按组件实例隔离。只调整 UI、CSS、i18n、测试和可访问表达，未改变业务逻辑、数据、文章属性、索引、端点或设置语义。

- 当前改动文件：`src/index.scss`、`src/ui/HighlightView.svelte`、`src/ui/ReaderTab.svelte`、`src/ui/StatsView.svelte`、`public/i18n/zh_CN.json`、`public/i18n/en_US.json`、`tests/accessibility.test.ts`、`tests/header-actions.test.ts`、`docs/DECISIONS.md`、`docs/PROGRESS.md`、`docs/HANDOFF.md`。
- 已生成截图：`output/playwright/round34-stats-desktop.png`、`output/playwright/round34-stats-mobile.png`；为本地组件预览，非真实思源内核运行或 Android 真机验收。
- `pnpm run check` 0 错误/0 警告；`pnpm test` 1149/1149；`pnpm build`、`pnpm task:ledger -- --check`、`git diff --check` 通过。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

## 既往交接（2026-10-07 T-3260/D-0155）

第三十二轮收口统计筛选、热力图和摘录操作层级：统计口径折叠、补充指标命名、窄屏筛选纵向全宽排列，热力图图例放到日期网格下方；摘录选择与导出采用独立命名分组并移除重复嵌套，跨页序号连续；阅读区窄屏高度规则去重。只调整 UI、CSS、i18n、测试和可访问表达，未改变业务逻辑、数据、文章属性、索引、端点或设置语义。

- 当前改动文件：`src/index.scss`、`src/ui/HighlightView.svelte`、`src/ui/StatsView.svelte`、`public/i18n/zh_CN.json`、`public/i18n/en_US.json`、`tests/accessibility.test.ts`、`tests/header-actions.test.ts`、`docs/DECISIONS.md`、`docs/PROGRESS.md`、`docs/HANDOFF.md`。
- 已生成截图：`output/playwright/round33-dark-desktop.png`、`output/playwright/round33-dark-mobile.png`；为本地组件预览，非真实思源内核运行或 Android 真机验收。
- `pnpm run check` 0 错误/0 警告；`pnpm test` 1148/1148；`pnpm build`、`pnpm task:ledger -- --check`、`git diff --check` 通过。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

## 既往交接（2026-10-07 T-3260/D-0154）

第三十一轮收口统计主路径、维护弹窗和阅读侧栏：统计首屏按原型保留三张主指标卡，候选指标使用短文案，索引快照折叠收纳其余数字，390px 改为单列；分布区恢复命名 section。摘录预览和今日拾遗标题 ID 按组件实例隔离，导入/迁移进度恢复读屏播报，阅读侧栏辅助文字统一主题字号。只调整 UI、CSS、i18n、测试与可访问表达，未改变业务逻辑、数据、文章属性、索引、端点或设置语义。

- 当前改动文件：`src/index.scss`、`src/ui/BackupPanel.svelte`、`src/ui/HighlightView.svelte`、`src/ui/ImportDialog.svelte`、`src/ui/MigrateDialog.svelte`、`src/ui/OnboardingDialog.svelte`、`src/ui/ResurfaceView.svelte`、`src/ui/SettingsView.svelte`、`src/ui/StatsView.svelte`、`public/i18n/zh_CN.json`、`public/i18n/en_US.json`、`tests/accessibility.test.ts`、`tests/header-actions.test.ts`。
- 已生成统计页预览截图：`output/playwright/round31-stats-current-desktop.png`、`output/playwright/round31-stats-current-mobile.png`；截图为本地组件预览，非真实思源内核运行或 Android 真机验收。
- `pnpm run check` 0 错误/0 警告；定向 UI/i18n/可访问性 67/67；全量 `pnpm test` 曾因旧四列断言失败，断言已同步新契约，提交前需复跑全量测试、`pnpm build`、`pnpm task:ledger -- --check` 与 `git diff --check`。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

## 当前有效交接（2026-10-07 T-3260/D-0153）

第三十轮收口工作台、阅读与全局控件状态：预览/收件箱补实例唯一 ID、加载错误播报和操作状态；阅读工具栏拆分次级动作，上下文切换增加加载骨架，Protyle 标签 ID 关联修正；全局按钮、输入、状态表面、滚动条及移动导航补焦点和主题层级。未改变业务逻辑、数据、文章属性、端点或设置语义。

- 当前改动文件：`src/index.scss`、`src/ui/AuthorEditor.svelte`、`src/ui/ClipRankControls.svelte`、`src/ui/InboxSection.svelte`、`src/ui/LibraryFilters.svelte`、`src/ui/ProtyleHost.svelte`、`src/ui/ReaderTab.svelte`、`src/ui/ReadingContext.svelte`、`src/ui/ReadingPositionControls.svelte`、`src/ui/WorkbenchPreview.svelte`。
- 已生成静态回归截图：`output/playwright/round30-desktop.png`、`output/playwright/round30-mobile.png`；截图为暗色 prototype fixture 回归，非真实思源内核运行或 Android 真机验收。
- 定向回归 100/100；全量检查、测试、构建、任务账本和最终差异检查在提交前执行。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

## 当前有效交接（2026-10-07 T-3260/D-0152）

第二十九轮收口统计摘录、设置长页与弹窗表单：统计分布补标题和忙碌层级，摘录制卡保持卡片级反馈；备份分页、首启欢迎与选择状态适配窄屏；浮层、导入/迁移、排版和制卡弹窗补进度、步骤、错误关联及状态播报。未改变业务逻辑、数据、文章属性、端点或设置语义。

- 当前改动文件：`src/index.scss`、`src/ui/ActionPopover.svelte`、`src/ui/BackupPanel.svelte`、`src/ui/FlashcardDialog.svelte`、`src/ui/FormattingDialog.svelte`、`src/ui/HighlightView.svelte`、`src/ui/ImportDialog.svelte`、`src/ui/MigrateDialog.svelte`、`src/ui/OnboardingDialog.svelte`、`src/ui/StatsView.svelte`。
- 已生成静态回归截图：`output/playwright/round29-desktop.png`、`output/playwright/round29-mobile.png`；截图为当前暗色 prototype fixture 回归，非真实思源内核运行或 Android 真机验收。
- `pnpm run check` 0 错误/0 警告；定向回归 322/322；全量测试、构建、任务账本和最终差异检查在提交前执行。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

## 当前有效交接（2026-10-07 T-3260/D-0151）

第二十八轮收口阅读伴生、维护流程和工作台状态：阅读上下文/作者编辑/阅读位置补标题与控件关联、操作分组和状态层级；导入/迁移/备份/制卡恢复补进度播报、阶段表面、长文案边界和忙碌反馈；预览/筛选/收件箱/空结果补当前筛选高亮、条目忙碌态和清除筛选动作。未改变业务逻辑、数据、文章属性、端点或设置语义。

- 当前改动文件：`src/index.scss`、`src/ui/AuthorEditor.svelte`、`src/ui/BackupPanel.svelte`、`src/ui/DockPanel.svelte`、`src/ui/FlashcardRecoveryPanel.svelte`、`src/ui/ImportDialog.svelte`、`src/ui/InboxSection.svelte`、`src/ui/LibraryFilters.svelte`、`src/ui/MigrateDialog.svelte`、`src/ui/ReadingContext.svelte`、`src/ui/ReadingPositionControls.svelte`、`src/ui/WorkbenchPreview.svelte`。
- 已生成静态回归截图：`output/playwright/round28-desktop.png`、`output/playwright/round28-mobile.png`；截图为当前暗色 prototype fixture 回归，非真实思源内核运行或 Android 真机验收。
- `pnpm run check` 0 错误/0 警告；定向回归 102/102；`pnpm test` 1146/1146、`pnpm build`、`pnpm task:ledger -- --check`、`git diff --check` 已通过。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

## 当前有效交接（2026-10-07 T-3260/D-0150）

第二十七轮继续收口设置异步、移动更多菜单和暗色空态：设置分组补标题关联，重建索引按钮防重入并显示忙碌反馈；移动更多菜单补首项聚焦、键盘导航、Tab 收起和长文案截断；暗色空态/加载/错误表面补独立层级与内高光；阅读位置无消息时隐藏空状态条，评分控件补 group 语义。未改变业务逻辑、数据、文章属性、端点或设置语义。

- 当前改动文件：`src/index.scss`、`src/ui/DockPanel.svelte`、`src/ui/SettingsView.svelte`、`src/ui/ReadingPositionControls.svelte`、`src/ui/ClipRankControls.svelte`。
- 已生成静态回归截图：`output/playwright/round27-desktop.png`、`output/playwright/round27-mobile.png`；截图为当前 dark prototype fixture 回归，非真实思源内核运行或 Android 真机验收。
- `pnpm run check` 0 错误/0 警告；定向回归 62/62；全量测试、构建、任务账本和最终差异检查在提交前执行。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

## 当前有效交接（2026-10-07 T-3260/D-0149）

第二十六轮收口 AI 批处理、候选迁移和 Protyle/阅读伴生区：AI 面板按说明、任务状态、预览和确认层级重排，并补忙碌/错误/窄屏分页反馈；候选治理提示、候选行、迁移/导入结果按来源、状态与操作分层；Protyle 加载/失败状态和阅读伴生区补标题关联及失败操作触控高度。只调整 UI、CSS 和可访问表达，未改变业务逻辑、数据、文章属性、端点或设置语义。

- 当前改动文件：`src/index.scss`、`src/ui/AiBatchPanel.svelte`、`src/ui/DockPanel.svelte`、`src/ui/ProtyleHost.svelte`、`src/ui/ReaderTab.svelte`。
- 已生成静态回归截图：`output/playwright/round26-desktop.png`、`output/playwright/round26-mobile.png`；截图包含现有工作台/阅读基线和本轮 AI/候选静态 fixture，非真实思源内核运行验收。
- `pnpm run check` 0 错误/0 警告；定向回归 119/119；`pnpm test` 1146/1146、`pnpm build`、`pnpm task:ledger -- --check`、`git diff --check` 已通过。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

## 当前有效交接（2026-10-07 T-3260/D-0148）

第二十五轮继续收口回顾、移动筛选和维护状态：统计/摘录/今日拾遗建立更清晰的内容起线、预览、忙碌和已开始状态层级；移动筛选抽屉在 420px 以下保留并排等宽动作，入口、抽屉和批量选择补齐可访问关联；首启、导入、备份和闪卡恢复处理窄屏边界与状态播报。未改变业务逻辑、数据、文章属性、端点或设置语义。

- 当前改动文件：`src/index.scss`、`src/ui/DockPanel.svelte`、`src/ui/FlashcardRecoveryPanel.svelte`、`src/ui/ResurfaceView.svelte`、`public/i18n/zh_CN.json`、`public/i18n/en_US.json`。
- 已通过：`pnpm run check` 0 错误/0 警告；定向回归 134/134；`pnpm test` 1146/1146；`pnpm build`、`pnpm task:ledger --check`、`git diff --check`。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

## 当前有效交接（2026-10-07 T-3260/D-0147）

第二十四轮收口工作台、阅读和设置的响应式层级：筛选/rail/行表/看板统一低对比表面和选中边界；阅读工具栏、伴生栏标题、忙碌反馈与窄屏正文留白统一；设置页在 420px 容器内让控件按内容顺序落行，footer 状态与动作清晰分栏。静态桌面与 390px 预览复核无横向溢出。未改变业务逻辑、数据、文章属性、端点或设置语义。

- 当前改动文件：`src/index.scss`、`src/ui/DockPanel.svelte`、`src/ui/ReaderTab.svelte`。
- 已通过：`pnpm run check` 0 错误/0 警告；reader/accessibility 定向回归 12/12；静态截图为 `output/playwright/round24-desktop.png`、`output/playwright/round24-mobile.png`。
- `pnpm test` 1146/1146、`pnpm build`、`pnpm task:ledger --check`、`git diff --check` 已通过；版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

## 当前有效交接（2026-10-07 T-3260/D-0146）

第二十三轮继续按原型收口统计、摘录与维护流程：统计指标卡、热图图例、日报表和完成列表建立更清晰的层级与边界，摘录根面板、首启进度和闪卡恢复补齐标题/状态语义；迁移、导入、备份和闪卡恢复在窄屏按内容顺序换行或堆叠，保留 44px 操作高度。暗色桌面和移动截图已复核，未发现需要继续改 CSS 的明显掉分项。未改变业务逻辑、数据、文章属性、端点或设置语义。

- 当前改动文件：`src/index.scss`、`src/ui/StatsView.svelte`、`src/ui/HighlightView.svelte`、`src/ui/OnboardingDialog.svelte`、`src/ui/FlashcardRecoveryPanel.svelte`。
- 已通过：`pnpm run check` 0 错误/0 警告；定向回归 147/147；`git diff --check`。截图：`output/playwright/round23-dark-desktop.png`、`output/playwright/round23-dark-mobile.png`。
- `pnpm test` 1146/1146、`pnpm build`、`pnpm task:ledger --check`、`git diff --check` 已通过；版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

## 当前有效交接（2026-10-07 T-3260/D-0145）

第二十二轮继续打磨主题与状态细节：暗色宿主统一原生控件、控件阴影、状态徽章和 hover 表面；工作台加载、错误、空库、收件箱、Rail 无匹配、今日拾遗空态补齐状态容器、图标、读屏语义和 reduced-motion。阅读器在 720/420 断点对长中文动作做截断和等宽布局，侧栏标题与区域关联，320/390/720/1280 预览保持可操作。未改变业务逻辑、数据、文章属性、端点或设置语义。

- `pnpm run check` 0 错误/0 警告；定向 UI 回归 67/67；`pnpm test`、`pnpm build`、`pnpm task:ledger --check`、`git diff --check` 通过；预览截图为 `output/playwright/round22-reader-1280.png`、`round22-reader-720.png`、`round22-reader-390.png`、`round22-reader-320.png`。版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

## 当前有效交接（2026-10-07 T-3260/D-0144）

第二十一轮继续打磨桌面与长页：宽屏工作台按原型收紧头部/视图切换和列表列宽，看板、主内容、预览拖拽边界分离；阅读页补正文主题背景、32/56/64px 留白、选区色、滚动隔离和 300px 伴生栏，工具栏显示载体/站点/状态副标题；设置页为 sticky footer 预留滚动空间，统一错误、备份结果、文件选择和 AI 日志的状态表面与窄屏换行。未改变业务逻辑、数据、文章属性、端点或设置语义。

- `pnpm run check` 0 错误/0 警告；阅读/无障碍/i18n 定向回归 17/17；`pnpm test`、`pnpm build`、`pnpm task:ledger --check`、`git diff --check` 通过；预览截图为 `output/playwright/round21-desktop-before.png`、`output/playwright/round21-desktop-after.png`、`output/playwright/round21-reader-final.png`。版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

## 当前有效交接（2026-10-07 T-3260/D-0143）

第二十轮继续打磨窄屏与设置细节：阅读工具栏在窄容器中按“模式 → 侧栏 → 完成 → 辅助”排列，伴生栏状态动作统一宽度并补忙碌/分组语义；快捷键面板与侧栏补 `aria-controls`。移动更多菜单计算相对顶部偏移后的可视高度，极窄顶栏状态只保留固定胶囊。设置页统一工作区/数据标题标记、恢复卡表面、AI 开关尺寸及窄屏安全区。未改变业务逻辑、数据、文章属性、端点或设置语义。

- `pnpm run check` 0 错误/0 警告；定向 UI 回归 67/67；`pnpm test` 1146/1146；`pnpm build`、`pnpm task:ledger --check`、`git diff --check` 通过；预览截图为 `output/playwright/round20-mobile-320.png`、`output/playwright/round20-mobile-landscape.png`。版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

## 当前有效交接（2026-10-06 T-3260/D-0142）

第十八轮将阅读主动作归位：工具栏承载“读完并下一篇”，伴生栏隐藏重复的“标记已读”，其他画布仍保留通用状态动作。设置页把导入入口做成与备份/恢复一致的内嵌卡片，窄屏统一内缩；移动更多菜单的迁移、导入、设置归入“维护工具”。移动批量条和菜单已在 390px/320px 截图中验证没有底栏遮挡或横向溢出。未改变业务逻辑、数据、文章属性、端点或设置语义。

- `pnpm run check` 0 错误/0 警告；定向 UI 回归 67/67；`pnpm test` 1146/1146；`pnpm build`、`pnpm task:ledger --check`、`git diff --check` 通过。版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

## 当前有效交接（2026-10-06 T-3260/D-0141）

第十七轮继续收口新增能力的状态层级：移动批量操作条避开底部导航和安全区，按钮保持触控命中区并在窄屏换行；忙碌时有 `aria-busy` 与整体降噪。移动更多菜单的 Escape 会回到触发按钮，进入设置/弹窗/维护入口不抢回新窗口焦点。设置页提升数据与恢复、导入主动作，维护工具标题降权；阅读伴生栏补齐阅读时长胶囊、utility/enhanced 标题标记和 AI 卡片表面融合。未改变业务逻辑、数据、文章属性、端点或设置语义。

- 预览截图：`output/playwright/round18-mobile-full.png`。真实思源宿主三画布、主题切换和移动设备仍待 B-0002。
- `pnpm run check` 0 错误/0 警告；定向 UI 回归 74/74；`pnpm test` 1146/1146；`pnpm build`、`pnpm task:ledger --check`、`git diff --check` 通过。版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

# 当前有效交接（2026-10-06 T-3260/D-0140）

第十六轮继续按增量原型收口视觉层级：工作台列表/看板、保存视图、预览侧栏和批量 AI 降为紧凑次级层；阅读页将低频工具标为 utility，摘录/朗读/AI 归为 enhanced，正文完成动作保持主层级；移动更多菜单限制高度并滚动；设置页补齐工作区、数据与恢复、维护工具双语分组。未改变业务逻辑、数据、文章属性、端点或设置语义。

- `pnpm run check` 0 错误/0 警告；定向 UI 回归 45/45；`pnpm test` 1146/1146；`pnpm build`、`pnpm task:ledger --check`、`git diff --check` 通过。版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。
- 预览截图：`output/playwright/round17-desktop.png`、`output/playwright/round17-mobile.png`；真实思源宿主三画布、主题切换和移动设备仍待 B-0002。

# 当前有效交接（2026-10-06 T-3260/D-0139）

已完成“代码新增功能是否超出原型”的对照与校准。新增 `design/prototype-v2-additions.html`，补画高级工作台批量任务、维护数据与恢复、阅读增强、统计次级回顾和平台入口归属。设置页将备份/恢复、闪卡恢复、外部导入从看板/危险区拆出；移动更多菜单把迁移/导入/设置归入维护组；批量 AI 使用次级色。主流程仍以继续阅读、候选确认、今日拾遗和最近收录为最高视觉层级。未改变业务逻辑、数据、属性、端点或 i18n。

- `pnpm run check` 0 错误/0 警告；定向 UI 回归 45/45；`pnpm test` 1146/1146；`pnpm build`、`pnpm task:ledger --check`、`git diff --check` 通过。版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

# 当前有效交接（2026-10-06 T-3260/D-0138）

第十五轮视觉复核完成源码收口：筛选下拉、Action Popover、移动筛选抽屉统一 34px 控件密度、inset surface、焦点环、滚动槽和选中态，浮层在焦点移出时自动收起；统计完成列表、日报表和作者分布补齐长标题/长名称处理、日期与数字对齐、固定列宽和空态卡片。Dock、阅读、设置与今日拾遗的重试、保存、AI、导出、撤销和卡片动作补齐 `aria-busy`、等待光标和忙碌禁用反馈，视图/队列/排序补齐 `aria-pressed`，嵌入表单的动作按钮声明 `type=button`。功能逻辑、数据、文章属性、端点和 i18n 未变。

- `pnpm run check` 0 错误/0 警告；定向回归 141/141；`pnpm test` 1146/1146；`pnpm build`、`pnpm task:ledger --check`、`git diff --check` 与桌面/移动/暗色截图复核通过。版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。
- 本轮截图：`actual-after-15-desktop.png`、`actual-after-15-mobile.png`、`actual-after-15-dark.png`（Codex 可视化目录）。真实思源三画布、移动设备、暗色主题仍待 B-0002。

# 当前有效交接（2026-10-06 T-3260/D-0137）

第十四轮视觉复核完成：Dock 刷新、阅读伴生栏上下文读取、设置页多类异步操作补齐忙碌/失败/重试反馈；按钮基线、焦点环、卡片描边和分组表面统一；移动端补齐 44px 横向命中区、safe-area、touch-action、滚动边界、无 hover 处理和暗色原生控件配色。功能逻辑、数据、文章属性、端点和 i18n 未变。

- `pnpm run check` 0 错误/0 警告；定向回归 141/141；`pnpm test` 1146/1146；`pnpm build`、`pnpm task:ledger --check`、`git diff --check` 与桌面/移动/暗色截图复核通过。版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。
- 真实思源三画布、移动设备、暗色主题仍待 B-0002。

# 当前有效交接（2026-10-06 T-3260/D-0136）

第十三轮视觉复核完成源码收口：迁移/导入/备份/格式化/闪卡/首启弹窗补齐滚动边界、sticky 操作栏、窄屏安全区、标题描述语义、空态与忙碌反馈；Dock、重浮与高亮长文本增加提示；全局焦点、滚动条、错误色和动效时长继续按 b3/glean 令牌统一。功能逻辑、数据、文章属性、端点和 i18n 未变。

- `pnpm run check` 0 错误/0 警告；定向回归 213/213；`pnpm test` 1146/1146；`pnpm build`、`pnpm task:ledger --check`、`git diff --check` 与桌面/移动/暗色截图复核通过。版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。
- 真实思源三画布、移动设备、暗色主题仍待 B-0002。

# 当前有效交接（2026-10-06 T-3260/D-0135）

第十二轮视觉复核完成：设置与统计长页补齐分组扫描、主题化开关、筛选周期、表头滚动和移动指标；移动顶栏更多菜单和收件箱补齐图标、长状态与展开语义；候选、首启、导入和批量 AI 面板补齐进度轨道、阶段状态、字段聚焦、重复行、忙碌与错误反馈。功能逻辑、数据、文章属性、端点和 i18n 未变。

- `pnpm run check` 0 错误/0 警告；定向回归 147/147；`pnpm test` 1146/1146；`pnpm build`、`pnpm task:ledger --check`、`git diff --check` 通过。版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。
- 真实思源三画布、移动设备、暗色主题仍待 B-0002。

# 当前有效交接（2026-10-06 T-3260/D-0134）

第十一轮视觉复核完成：工作台看板、库列表、侧栏和预览面板补齐空列、拖拽、选中、长内容、滚动与窄屏层级；阅读页和伴读工具统一 AI 加载、来源、摘录、阅读位置与主动作反馈；备份、作者、格式化、闪卡、恢复和 Protyle 宿主补齐标题头、状态、错误/成功/忙碌和移动触控密度。功能逻辑、数据、文章属性、端点和 i18n 未变。

- `pnpm run check` 0 错误/0 警告；`pnpm test` 1146/1146；`pnpm build`、`pnpm task:ledger --check`、`git diff --check` 和桌面/移动/暗色截图复核均通过。版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。
- 真实思源三画布、移动设备、暗色主题仍待 B-0002。

# 当前有效交接（2026-10-06 T-3260/D-0133）

第十轮视觉复核完成：设置/迁移/导入维护面板统一分组、焦点、按钮、日志空态、进度和移动命中区；统计页指标、字段、热力图、分布和完成列表补齐层级反馈；今日拾遗卡片与空态调整摘要和操作层级；移动顶栏、更多菜单、底部导航及收件箱补齐任务状态、选中、忙碌、失败和空态表达。功能逻辑、数据、文章属性、端点和 i18n 未变。

- 本轮需收尾验证 `pnpm check`、统计/重浮/设置/迁移/移动定向回归、全量测试、构建、任务账本和最终截图；版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。
- 真实思源三画布、移动设备、暗色主题仍待 B-0002。

# 当前有效交接（2026-10-06 T-3260/D-0132）

第九轮视觉复核完成：摘录墙补齐标题与范围胶囊、筛选 surface、引用卡标签/序号/标签胶囊、footer 操作、状态 surface 和移动触控密度；候选预览将证据/缺失字段变为 signal/missing 胶囊；导入与 onboarding 统一表单、分页、空态和错误态并移除局部内联尺寸。功能逻辑、收录确认、导入迁移、文章属性、索引、端点和 i18n 未变。

- 本轮需收尾验证 `pnpm check`、摘录/候选/导入/无障碍定向回归、全量测试、构建、任务账本和最终截图；版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。
- 真实思源三画布、移动设备、暗色主题仍待 B-0002。

# 当前有效交接（2026-10-06 T-3260/D-0131）

第八轮视觉复核完成：阅读页工具栏、快捷键、目录、摘录和 AI 结果统一表面层级，窄容器下正文与伴生栏纵向排列；工作台 rail 固定 216px，库列表、预览分隔、看板和浮层统一选中/悬浮/焦点状态；批量 AI 预览补齐滚动、错误和移动触控密度。功能逻辑、文章属性、索引、AI 请求、端点和 i18n 未变。

- 本轮需收尾验证 `pnpm check`、阅读/工作台定向回归、全量测试、构建、任务账本和最终截图；版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。
- 真实阅读页签、三画布、移动设备、暗色思源主题仍待 B-0002。

# 当前有效交接（2026-10-06 T-3260/D-0130）

第七轮视觉复核完成：统计长页分成总览、活跃、分布和完成四个区块，热力图可横向滚动并适配移动网格；设置、迁移、导入弹窗统一标题头、进度卡、错误块和未保存状态；新增表面令牌让暗色主题下的骨架、选中态、指标和卡片阴影保持层级。统计口径、导出、设置保存、迁移写入及 i18n 未变。

- 本轮需收尾验证 `pnpm check`、定向回归、全量测试、构建、任务账本和最终截图；版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。
- 真实移动设备、三画布和暗色主题仍待 B-0002。

# 当前有效交接（2026-10-06 T-3260/D-0129）

第六轮视觉复核完成：移动更多菜单具备外部点击、失焦和 Escape 收起；高亮加载有骨架卡和工具组语义；统计热力图、完成列表空态、无效日期和执行状态更易读；排序、清除、导入和设置提示统一 SVG 图标，统计主次指标层级更清晰。功能、数据、属性、端点和 i18n 保持不变。

- 本轮需收尾验证 `pnpm check`、定向回归、全量测试、构建、任务账本和最终截图；版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。
- 真实移动设备、三画布和暗色主题仍待 B-0002。

# 当前有效交接（2026-10-06 T-3260/D-0128）

第五轮视觉复核完成：重浮内嵌视图去掉重复标题栏，移动副标题显示当前重浮数量；来源、搜索、关闭、编辑、制卡和迁移动作统一 SVG 图标；统计、候选、摘录空状态和选中工具条补齐轻层级；移动筛选、收件箱、治理操作统一 44px 命中区并明确禁用态。功能逻辑、数据聚合、文章属性、端点和 i18n 保持不变。

- `pnpm check` 0 错误/0 警告；定向 UI/a11y/视觉/阅读/迁移回归 69/69；全量测试、构建、任务账本和截图复核需在本轮收尾继续完成。
- 真实移动设备、三画布和暗色主题仍待 B-0002；版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

# 当前有效交接（2026-10-06 T-3260/D-0127）

第四轮视觉精修完成：队列激活态和候选卡更接近原型的轻层级表达，统计分布变为独立面板，完成列表日期对齐；摘录卡补充琥珀侧标、引用层级和选中反馈；迁移、来源、制卡动作统一为 SVG 图标。未改变功能、数据聚合、属性、端点或 i18n。

- 定向 UI/a11y 与视觉契约 45/45、`pnpm check` 0 错误/0 警告、全量测试 1146/1146、构建和任务账本门禁均已通过。
- 真实移动设备、三画布和暗色主题仍待 B-0002；版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

# 当前有效交接（2026-10-06 T-3260/D-0126）

第三轮视觉精修完成：移动首页的返回位置显示品牌麦穗锚点，子视图返回箭头和逻辑不变；候选卡编辑、本地收录、排除动作改用统一 SVG 图标。未改变功能、属性、端点或 i18n。

- 定向 UI/a11y 40/40、`pnpm check` 0 错误/0 警告、全量测试 1146/1146、构建和任务账本门禁均已通过。
- 真实移动设备、三画布和暗色主题仍待 B-0002；版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

# 当前有效交接（2026-10-06 T-3260/D-0125）

第二轮视觉复核已完成：降低卡片边框重量，补齐思源暗色根选择器和状态徽章对比度；桌面摘录控件恢复紧凑 32px，移动端维持 44px；Dock/收件箱/今日拾遗/阅读页的操作图标统一为 SVG symbol。所有交互、属性、端点和 i18n 保持不变。

- `pnpm check`、`pnpm test` 1146/1146、`pnpm build`、定向 UI/a11y 40/40 均通过；第二轮 localhost 截图已完成，临时页面/浏览器目录已清理。
- 真实思源暗色主题、三画布密度和移动触控仍需 B-0002；版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

# 当前有效交接（2026-10-06 T-3260/D-0124）

本轮完成 `design/prototype-v2.html` 对照下的 v2 视觉精修：新增共享 `glean-*` 间距/字号/圆角/描边令牌，统一 Dock/Tab/浮窗/移动视图的层级、卡片、统计指标、滚动条和交互反馈；摘录、统计、设置的局部样式已集中进 `src/index.scss`，功能逻辑、文章属性、端点和 i18n 未变。

- 本地 localhost 预览已截取改前/改后对照；`pnpm check` 0 错误/0 警告、`pnpm test` **1146/1146**、`pnpm build` 通过。临时预览文件和浏览器临时目录已清理。
- 浏览器预览只证明 CSS/组件结构可渲染；真实思源三画布、主题切换、移动触控和 3×8 状态截图仍待 B-0002。版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

# 当前有效交接（2026-10-06 T-3292）

本轮继续开发 T-3292：窄 Dock 搜索打开后自动聚焦；输入关键词时出现双语清空按钮，清空后焦点回到输入框，移动端命中区保持 44px。新增 `panel.searchClear` 双语键与无障碍静态回归。

- 定向无障碍/i18n 测试 14/14、`pnpm check` 0 错误/0 警告通过；真实 Dock 宽度、键盘和移动触控仍待 B-0002。
- 版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

# 当前有效交接（2026-10-06 T-3293 脚本与文档收口）

T-3293 的写型冒烟/E2E 安全加固已补齐运行约定与验收归属：真实隔离靶场全套实跑单列为 **B-0012**；B-0008 继续只表示小驴打卡双插件桥联调。`docs/SMOKE-E2E.md` 已明确辅助流程的临时库前缀注册、目录 spike 命令、同内核串行和结束 `lsNotebooks` 清扫证据要求；事务探针包含重启步骤，检测到附着参数会在写入前拒绝；`docs/DECISIONS.md` 记录 D-0123。

- 作者执行 T-3293 时须使用独立 workspace、6807 起的回环端口、与主工作区不同的 token，并只安装本插件；先验证主工作区被 `lsNotebooks` 防呆拒绝，再在空靶场串行跑全套，最后复跑 `lsNotebooks` 确认无残留。
- 本轮完成脚本参数语义收口与文档同步；全量 `pnpm test` 1146/1146、`pnpm check`、`pnpm build`、`pnpm check:release` 和任务账本门禁通过。未触碰作者主工作区、未打 tag、未创建 Release、未上传 package.zip。代码侧仍需作者按 B-0012 在隔离靶场实跑并核对最终 `lsNotebooks` 无残留。

# 当前有效交接（2026-10-06 T-3274–T-3291）

本轮完成综合状态评审和精品化下一阶段执行板，详见 `docs/STATUS-REVIEW-2026-10-06.md`。当前定位是“思源剪藏阅读库与每日拾遗”：核心收录、五态分拣、阅读、摘录、回顾、AI 和生态入口已有较完整代码及隔离证据，但不能把它们写成真实宿主/真机/模型已验收。

- 新增 T-3274–T-3291：先复跑全量门禁，随后按 P0 关闭桌面主链、Android 主链、真实剪藏和数据主权，再做视觉、无障碍、交互、性能、AI、外部集成、品牌和发布闭环。
- 本轮发现并修正导入进度测试的时间脆弱性：固定历史 `updatedAt` 早于运行时 `createdAt` 会被严格解析器正确判为 `invalid`；定向 `tests/import-service.test.mjs` 已 22/22 通过。文档更新后全量 `pnpm test` **1138/1138**、`pnpm check`、构建、发布门禁和任务账本检查均通过。
- 当前版本保持 `1.1.0`。视觉矩阵 24 个真实宿主截图槽位、B-0001/B-0002/B-0004–B-0008 仍未关闭；不要用浏览器窄视口、服务 E2E 或隔离 spike 代替真机/真实服务证据。
- 不打 tag、不创建 Release、不上传 `package.zip`、不提交集市，直到作者逐次授权；头像、README/GitHub 头图与五张真实截图依赖真实验收后的素材。

# 当前有效交接（2026-10-05 T-3273/D-0122）

本轮完成选区事件宿主快速门禁：ReaderTab 与 WorkbenchPreview 的全局 `selectionchange` 回调先调用 `selectionBelongsToHost` 检查非折叠选区的 anchor/focus 是否在当前正文宿主内，宿主外或缺失节点直接清空摘录；完整 `excerptFromSelection` 仍复核所有 Range 端点、文本和块 ID。

- 该优化只减少无关编辑器选区触发的 DOM/range 工作，不改变跨块摘录、复制降级或引述插入语义；新增端点、折叠、异常/跨宿主回归和 UI 接入断言。
- T-3273 全量 `pnpm test`、`pnpm check`、构建、性能基线和发布门禁已通过；`pnpm task:ledger --write && pnpm task:ledger --check` 已同步并保持 14 项当前任务。
- 真实 Protyle 多窗口选区事件、移动端频率和布局仍待 B-0002；版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

# 当前有效交接（2026-10-05 T-3272/D-0121）

本轮完成真实阅读计时：新增独立 `custom-clip-read-minutes`，阅读页签仅在可见、获焦、阅读模式且正文宿主已渲染时累计；链接、缺失正文、隐藏、失焦、切文、销毁和宿主不可用均不计时。秒余数只存在当前页签会话，显式标记已读成功后才写回完整分钟。

- `clip-store` 以原始阅读分钟属性、状态和文档位置为预期值，同文串行写入并写后读回；并发修改、移动、写入失败或读回不一致均拒绝覆盖，状态成功后计时写失败不会回滚状态，也不自动重试。
- 预计分钟与实际分钟独立；备份/CSV 原样携带，桥接只读投影增加 `readMinutes`，索引不作为事实源。计时纯函数、服务并发/位置回归、CSV/桥接/i18n、全量 `pnpm test` **1137/1137**、`pnpm check` 0 错误/0 警告已通过。
- 真实宿主前台焦点判定、切文、触控和窄屏布局仍待 B-0002；版本保持 `1.1.0`，不打 tag、不创建 Release、不上传 package.zip。

# 当前有效交接（2026-10-05 T-3271）

本轮完成会话内最近阅读历史：打开阅读文档时按确切 ID 去重并置顶，最多保留 8 条；阅读上下文成功读回后补充标题，伴生栏显示可点击列表，相关旧文切换也记录。历史只存在插件内存，未写文章属性、索引、设置或偏好，卸载/重启自然清空。

- T-3271 纯函数、i18n、全量 `pnpm test` **1131/1131**、`pnpm check` 0 错误/0 警告和 `git diff --check` 已通过；真实阅读页签切文、触控和窄屏布局仍待 B-0002。
- T-1801 候选分组暂缓：候选当前不能批量选择，完整分组确认还需逐条冲突/失败语义，不能只加 UI 分组。

# 当前有效交接（2026-10-05 T-3270）

本轮补充自定义 AI 通道明文 `http://` 地址提示：设置页显示双语 HTTPS 建议，不拦截保存、不改写地址、不触碰密钥或请求协议。真实 TLS、服务可达性和模型效果仍待 B-0004。

- T-3270 定向 i18n/无障碍回归、全量 `pnpm test` **1129/1129**、`pnpm check` 0 错误/0 警告、生产构建、性能基线、发布门禁和任务账本均通过。

# 当前有效交接（2026-10-05 T-3268/T-3269）

本轮完成 T-3268 收录后自动快照与 T-3269 Dock 治理统计优化。自动快照由默认关闭的 `snapshotOnCapture` 控制，统一收录入口在属性/索引成功后生成 HTML 资产；失败保留收录并可手动重试，备份恢复强制关闭自动写。Dock 状态 rail、收件箱配额和超龄池共享一次索引遍历，筛选、排序和治理语义不变。

- 自动快照服务回归、全量 `pnpm test` **1129/1129**、`pnpm check` 0 错误/0 警告、生产构建、性能基线、发布门禁和任务账本均通过；README、能力矩阵、PROGRESS、TODO 与 D-0117/D-0118 已同步。
- 真实思源 assets、图片/链接保真、移动端、大文档和三画布性能仍待 B-0002/B-0006；本轮不触碰作者常驻实例，不打 tag、不创建 Release、不上传 package.zip。

# 当前有效交接（2026-10-05 T-3220 隔离事务探针复跑）

本轮继续推进 `T-3220`：`pnpm spike:transactions` 在独立临时工作区 `C:\Users\sunku\AppData\Local\Temp\siyuan-glean-t3220-1791149318797-404`、思源 `3.8.6` 和动态端口 `52987` 通过，15 项验收检查全部为真。证据覆盖复杂树/嵌套列表/标题事务、跨父级移动、双 API 客户端并发、真实 PNG 字节、块嵌入、失败事务、插入删除、响应丢失读回和重启后正文保持。

- 结果已同步 `docs/PROGRESS.md`、`docs/FORMATTING-RESEARCH.md` 和 `TODO.md`；这次仍只证明隔离 API 服务边界，不替代真实编辑器。
- 双 Protyle、用户中间编辑、真实网络故障、资源权限/删除、编辑器渲染和真实宿主撤销仍待 B-0002/B-0006/B-0008 等真实环境；继续禁止原文排版生产入口和插件专属撤销。
- 本轮没有修改生产代码；版本保持 `1.1.0`，不合并主线、不打 tag、不发布。

# 当前有效交接（2026-10-05 T-3267/D-0116）

本轮完成 T-3267：制卡跨重载恢复。服务在插入前、插入后和 riff 登记后分别保存最小派生检查点；重载恢复按确切卡片块 ID 核验类型和宿主归属，设置页可打开宿主、重试登记或清理缺失记录。检查点不保存正文、引文、模型输出、文章属性或密钥；新制卡不会覆盖已有未完成恢复。

- 定向恢复/服务回归通过；全量 `pnpm test` **1114/1114**，`pnpm check` 类型与 Svelte 均 0 错误/0 警告，生产构建成功，`git diff --check` 通过。
- TODO 与 `docs/TASK-LEDGER.md` 已将 T-3267 标记为代码完成、隔离验证完成、真实验收待 B-0002/B-0006；真实 riff 牌组、宿主重载和删除/缺失确切卡片仍需作者操作。
- 版本保持 `1.1.0`，阶段提交保留在 `codex/e2e-session-isolation-20261005`；不合并主线、不打 tag、不发布。

# 当前有效交接（2026-10-05 T-3266/D-0115）

本轮完成 T-3266：`launch-e2e` 与 `prepare-workspace` 支持 `--plugin-dir`/manifest 校验，从目标插件的 `plugin.json` 与 `dist` 派生插件名/版本/产物，manifest 保存身份；`manage-e2e` 与验收账本接受通用插件会话标识并兼容旧小驴 manifest。每个插件仍使用独立工作区、回环端口、标记、manifest、日志和 PID；不能把跨插件并行服务 E2E 当成真实桌面/设备验收，当前继续保持不触碰作者思源实例。

上一轮待办审计完成 T-3263/T-3264/T-3265：s1-flow 与 launch-e2e 已支持独立工作区/端口；新增 manage-e2e 以 manifest、PID 和回环 API 安全停止。本轮两个 3.8.6 会话已并行启动并分别就绪后停止。新增 `scripts/e2e/acceptance-session.mjs`，把隔离内核、桌面宿主、Android/iOS 设备或模拟器、AI、外部文件和双插件联调分别记账；逐项结果要求证据 SHA-256，ready manifest 不能单独登记通过。M0/AV spike 已改为独立临时工作区、动态端口和独立结果文件；不能把浏览器窄视口、服务 E2E 或桌面截图当真机证据，当前继续保持不触碰作者思源实例。

验收账本默认写入系统临时目录。示例：先运行 `pnpm e2e:acceptance create --kind isolated-kernel --name s1 --workspace <workspace>`，再用 `link --session <session> --manifest <e2e-manifest>` 关联后台 E2E；真实 Android/iOS 会话必须补 `--real-device-confirmed true` 和证据后才能 `close --status passed`。该工具只管理证据元数据，不启动作者设备、不操作作者实例。

T-3262 的大库列表分批挂载代码与本地门禁已完成。筛选、排序、分面、结果数、批量选择和看板列计数仍使用完整索引；Dock 卡片、工作台行表和看板首批挂载 80 条，用户点击“加载更多”后继续挂载；工作台定位到窗口外文章会自动扩展到目标行。版本保持 `1.1.0`，不合并主线、不打 tag 或发布；阶段提交保留在 `codex/e2e-session-isolation-20261005`。

- 定向账本回归 `2/2`，M0/AV 隔离 spike `9/9`、`6/6`；本轮全量测试 `1110/1110`、类型检查、生产构建、性能基线和发布门禁均已通过。本轮 spike 仍只证明隔离内核契约；真实宿主性能归 B-0002。
- 窗口只影响 DOM 数量，不写 `custom-clip-*`、不改索引和选择语义；真实滚动/内存收益归 B-0002。
- T-3265 已收口任务账本：`TODO.md` 当前执行板是唯一开发承诺源，7 项任务全部具备代码、隔离验证、真实验收和延后/阻塞原因四栏；`pnpm task:ledger --check` 通过，历史重复编号只保留来源，旧交接下一任务不再作为当前计划。
- T-3266 已完成跨插件会话身份契约：目标插件由 `--plugin-dir` 指定，manifest 记录名称/版本/目录；新旧会话标识均可安全链接和停止，跨插件身份回归通过。

# 当前有效交接（2026-10-05 T-3261/D-0108）

T-3261 的今日拾遗置顶代码与隔离验证已完成。契约为独立 `custom-clip-pinned=YYYYMMDD`：用户明确钉住后当天优先，次日自然失效；今日拾遗、库卡片和工作台行表均可操作；不复用 priority，不改变状态、last-surfaced 或每日数量。版本保持 1.1.0，不提交、建分支、打 tag 或发布。

- schema/索引/重浮算法、双语文案、服务回归、全量测试、生产构建和发布门禁均已通过。
- 所有属性写入继续经 `src/services/clip-store.ts`；真实三画布观感归 B-0002。

# 当前有效交接（2026-10-05 T-3260/D-0107）

T-3260 的宽画布全视图审计和容器响应式统一已完成代码。统计页在宽工作台使用四列指标、双列分布；Dock、Tab、独立浮窗根面板共用 `glean-workbench` 容器名，库列表 600px 起按容器查询切换；设置、迁移和导入保持标准 560–760px 对话框与内部滚动。版本保持 1.1.0，不提交、建分支、打 tag 或发布。

- 宽画布静态/类型定向回归、全量测试、生产构建和发布门禁均已通过。
- 真实三画布密度、弹窗观感、触控与主题仍归 B-0002；下一步继续执行板中的未实现代码差额。

# 当前有效交接（2026-10-04 T-3258/D-0105）

T-3258 的治理提醒按日免打扰代码与静态回归已完成。配额、超龄和候选提醒分别可“今天不再显示”，日期写入 `ui-prefs.json`，次日自动恢复；保存失败恢复提示并反馈。版本保持 1.1.0，不提交、建分支、打 tag 或发布。

- 静默只影响展示，不写 `custom-clip-*`、不改变候选/归档/查看动作，也不改派生索引。
- 偏好/i18n/治理定向回归 24/24；真实三画布密度、触控和主题观感仍归 B-0002，继续处理当前任务板中的未实现代码差额。

# 当前有效交接（2026-10-04 T-3259/D-0106）

T-3259 的头部信息架构代码与静态回归已完成。桌面、工作台和独立浮窗副题显示当前视图与真实读库数量，图书馆筛选时追加筛选项数；移动端保留紧凑副题和同步状态。当前代码没有独立红色角标，候选数继续由治理提示表达。版本保持 1.1.0，不提交、建分支、打 tag 或发布。

- 变更只改显示投影，不新增文章属性、插件设置或索引字段。
- 真实宽窄画布观感、移动密度和触控仍归 B-0002；继续处理任务板中的未实现代码差额。

# 当前有效交接（2026-10-04 T-3257/D-0104）

T-3257 的治理横幅动作代码与静态回归已完成。候选检测提示增加“查看候选”，统一切到图书馆待分拣列表；宽工作台看板会自动切到列表。超龄提醒继续复用同一清单展开和显式归档流程。版本保持 1.1.0，不提交、建分支、打 tag 或发布。

- 入口只改变当前视图和会话筛选，不写文章属性、插件设置或派生索引。
- 真实三画布动作触控、焦点与观感仍归 B-0002；继续处理当前任务板中的未实现代码差额。

# 当前有效交接（2026-10-04 T-3256/D-0103）

T-3256 的首轮 icon-only 审计与代码已完成。宽工作台显示紧凑“更多操作”和排序方向的图标+文字；Dock 与移动端保持图标，所有入口继续提供完整 `title`/`aria-label`，状态主动作不重复加标签。版本保持 1.1.0，不提交、建分支、打 tag 或发布。

- 变更只涉及显示层与静态规则，不改变按钮动作、文章属性、插件设置或索引。
- 真实逐项桌面/移动可读性和触控观感仍归 B-0002；继续处理任务板中的未实现代码差额。

# 当前有效交接（2026-10-04 T-3255/D-0102）

T-3255 的摘录宽画布代码与静态回归已完成。工作台 Tab 与独立浮窗宽度达到 760px 时，摘录卡片区域使用 360px 最小宽度的自适应双栏/多栏，工具栏、预览和分页保持整行，空态居中；Dock 与移动端保持单列。版本保持 1.1.0，不提交、建分支、打 tag 或发布。

- 仅新增卡片容器和容器查询，不改变摘录保存、导出、选择或数据契约。
- 真实三画布密度、焦点、触控和主题观感仍归 B-0002；继续处理当前任务板中的未实现代码差额。

# 当前有效交接（2026-10-04 T-3254/D-0101）

T-3254 的宽画布代码与静态回归已完成。工作台 Tab 与独立浮窗宽度达到 760px 时，今日拾遗使用 310px 最小宽度的 2–3 列自适应卡片网格；动作可换行，Dock 与移动端保持单列。版本保持 1.1.0，不提交、建分支、打 tag 或发布。

- 布局使用 `glean-workbench` 容器查询，不新增设置、文章属性或索引字段；数据、动作和来源规则不变。
- 真实三画布的卡片密度、触控和主题观感仍归 B-0002；下一步继续处理当前任务板中的未实现代码差额。

# 当前有效交接（2026-10-04 T-3253/D-0100）

T-3253 的代码与静态回归已完成。多条配额、超龄候选和待确认候选提醒默认收纳为一条可展开摘要，单条提醒仍直接显示；展开后复用原有治理动作。版本保持1.1.0，不提交、建分支、打 tag 或发布。

- 收纳状态是组件会话状态，不进入文章属性、插件设置或派生索引；提醒计数只按当前实际可见提醒计算。
- 定向治理/i18n/a11y 回归 **16/16**，`pnpm check` 零错误/零警告；最终全量门禁将在本条之后重跑。
- T-3252/T-3253 的真实宽窄画布、三画布密度和触控观感仍归 B-0002；继续选择当前任务板中尚未实现的代码差额。

# 当前有效交接（2026-10-04 T-3252/D-0099）

T-3252 的代码与静态回归已完成。Dock 维持图标入口；Tab 和独立浮窗在 760px 容器阈值上显示图标+短文字，较窄时收起文字。版本保持1.1.0，不提交、建分支、打 tag 或发布。

- 三个头部动作使用既有双语完整名称作为 title/aria-label，显示短文案另有中英键；样式使用容器查询与 b3 变量，不增加偏好或属性。
- `tests/header-actions.test.ts` 覆盖短标签/无障碍名称、760px 容器断点、主题变量和浮窗/Tab 共用容器；真实桌面宽窄布局目视验收仍待 B-0002。
- 下一步继续从 TODO 的未承接代码差额中选最高优先级主任务；历史池已由 T-32xx 覆盖的功能按映射核对，避免重复实现。

# 当前有效交接（2026-10-04 T-3250 质量审计）

T-3250 的代码与隔离服务验收已完成；真实模型效果、真实 Protyle 选区和多端并发仍保留在 B-0002/B-0004。版本保持1.1.0，不提交、建分支、打 tag 或发布。

- 本文问答服务在调用前核验选区正文包含关系、长度、块 ID 和 SQL `root_id`；调用后再次核验块归属与文章属性/位置，变化时丢弃答案，已发生的模型用量仍保留。
- `tests/reader-ai.test.mjs` 与 `tests/article-question.test.ts` 定向回归 **52/52**；全量 `pnpm test` **1085/1085**、`pnpm check` 零错误/零警告、`pnpm build` 与 `pnpm check:release` 通过。T-3242–T-3250 的代码/隔离完成状态已同步到 `TODO.md`，剩余内容均为真实宿主、模型或跨客户端限制。
- 下一步审计 S0–S6 与旧任务池，只把尚未实现且属于当前规划的开发项转成新的明确主任务；不以旧交接中的“待开发”描述覆盖当前状态。

# 当前有效交接（2026-10-04 T-3251/D-0098 用户反馈修复）

T-3251 本轮代码和本地门禁完成，真实宿主大库体验仍需在作者设备确认。版本保持1.1.0，不提交、建分支、打 tag 或发布。

- 来源 URL：未知/缺失旧 `contentType` 下，只要 `custom-clip-url` 是有效 http(s) 就保留来源动作；`local` 不从正文偶然链接推断来源。中文路径和无效入口回退均有测试。
- 周报：`weekly_digest` 使用可信期间回顾口径，文本列出完成文章标题，结构化结果包含确切文档 ID、标题、站点和完成时间；internal、候选与未知完成时间不混入。
- 性能：DockPanel 先显示派生索引缓存，随后继续全量对账；同一插件并发对账合并，模板 Markdown 探测最多4路并发。三类扫描、完整性和失败保护未跳过。
- 验证：定向回归69/69；`pnpm check` 0错误/0警告；`pnpm test` 1082/1082；`pnpm build`、`pnpm check:release`、`pnpm perf:check` 通过。合成 10k 索引重建约107ms；隔离思源3.8.6 E2E 56/56，证据工作区 `C:\Users\sunku\AppData\Local\Temp\siyuan-glean-s1-1791120731749-7888`。真实宿主大库体验仍需在作者设备测量。

# 当前有效交接（2026-10-04 T-3239/T-3240/T-1815交付，继续备份恢复）

本条优先于历史记录。版本1.1.0，累计未提交工作保留，不提交/建分支/tag/发布/集市。

- T-3239/D-0085：author单行/控制字符/120码点校验，旧非法值只读不修写；作者含清空受手填保护。显式编辑读取原始值，同插件同文串行、写入点再次核对资格/值、写后读回；失败保留草稿并重读当前属性，不自动重发。列表/移动卡片Popover、工作台预览、阅读伴生栏共用AuthorEditor；切文/销毁丢弃旧结果。独立作者rail、移动筛选草稿、条件chip、保存视图、全五态作者时间线和完整属性CSV接线，不能以作者判候选资格。跨客户端无原子CAS限制保留。
- T-3240/D-0086：可信期间完成作者分布、站点→作者/缺失二级计数，站点/作者/两类标签Top8+其他项/次数可展开；报告保持全量和作者列，公式/Markdown转义。修复显式internal且已有状态的文档混入回顾：索引投影既有标记，不抹除原状态。作者缺失不推断，标签次数之和不当去重文章数。
- T-1815/D-0087：官方扩展1.15.15/00182d4b固定源码核查与真实模板函数探针通过。Readability可能有byline，但content消息/background模板未传署名，不支持DOM选择器。见CLIPPER-AUTHOR-RESEARCH与scripts/spike/clipper-author-probe.mjs；源码在临时目录glean-clipper-research-1791109884660，不改作者扩展、不发上游消息。
- 门禁：pnpm test **698/698**、pnpm check **0错误/0警告**，构建/产物检查、合成性能、视觉登记通过（仍0/24宿主图）。最近一次代码构建zip280025B、mtime2026-10-04 18:37:25；之后README/交接同步，后续产物需再次构建。不把这些数字当宿主/模型验收。
- 隔离3.8.6 E2E **29条**全通过：`C:\Users\sunku\AppData\Local\Temp\siyuan-glean-s1-1791110240454-29660`，author-evidence.json记录属性保护、重建/筛选/CSV、站点钻取、internal排除。只启动/关闭本任务内核，没有作者窗口操作。
- 下一主任务：T-1780版本化备份/恢复（新号T-3241、D-0088尚未使用），先契约，属性包只读导出、恢复preview/diff/冲突/逐条读回，经clip-store写入，索引只能重建。后续T-1813默认关闭AI建议/逐条确认、制卡编辑预览、批量AI/长任务恢复、阅读位置/计时仍待开发。真实109篇回填未执行；B-0001/B-0002/B-0004–B-0010、T-1832、T-3220/3221继续保留。

# 当前有效交接（2026-10-04 T-3236–T-3238交付，真实宿主待验收）

本条优先于下方历史交接。版本保持1.1.0，累计未提交工作全部保留，未提交/建分支/tag/发布/集市提交。

- T-3236/D-0082：工作台/浮窗列表就地原生Protyle preview，候选显示来源证据/缺失项，可确认、排除、转本地和补URL；已收录文章可分拣并继续本次可见列表。快速引述先复查文章和原块归属，无定位仅复制；旧目标操作完成不推进已切换的文章/筛选。拖条和原生range方向键/Home/End，比例扣除rail宽度；开关/比例仅写ui-prefs，移动全屏sheet、窄画布关闭入口均接线。
- 共用ProtyleHost/libs/protyle-controller：同文模式切换不重建、每文独立子宿主、迟到ready清理旧实例、resize观察及销毁、加载失败重试/原文入口。ReaderTab保留上下文/大纲/专注/快捷键。首启确认通过窗口会话参数直达候选，默认保存视图不能覆盖明确定位。修复公共模态Esc抢先关闭外层浮窗：当前Popover/预览优先，注册销毁幂等，IME/重复/宿主外部弹窗不接管；有实际事件分发回归，真实DOM仍待B-0002。
- T-3237/D-0083：桌面常用3项下拉/4项更多筛选，已应用条件chip可独立移除；移动保留草稿/应用sheet。行表常驻开始读/标记已读，低频动作和多选放原生顶层Popover，避免滚动容器裁切。AI与用户标签独立；看板收纳策略仍待实际评估。
- T-3238/D-0084：[x]代码/隔离修复。E2E复现属性已经URL/status而SQL IAL仍旧，查重先用派生索引已知ID补读当前属性，再取全SQL，缓存字段不作判定；严格索引读取失败和属性请求失败拒绝无冲突，满页都在已知ID中仍读取后续页。所有生产查重调用传插件实例。外部未知文档和多客户端并发没有原子唯一保证，不增加固定等待掩盖问题。
- 门禁：pnpm test **685/685**，pnpm check **0错误/0警告**，生产构建/产物检查、合成性能和视觉登记通过；视觉仍0/24真实宿主图。最新zip **275389B**，mtime **2026-10-04 17:59:48**，没有真实模型调用和作者实例操作。
- 隔离3.8.6服务E2E **26条**全部通过：`C:\Users\sunku\AppData\Local\Temp\siyuan-glean-s1-1791107059434-33716`；`preview-lookup-evidence.json`记录sqlKnown=false/conflictFromKnownIds=true，含补来源/确认/完成/归档/排除/本地/查重与引述归属链。原文正文保留，显式引述除外。
- 下一主任务：来源作者字段T-1811起（先契约和手填保护，旧T-1813“AI非手填”必须纠正，不能自动覆盖作者）、版本化只读备份与恢复preview/diff/冲突T-1780；后续AI制卡编辑预览、批量AI/长任务恢复和阅读位置/计时各自立主任务。仍有开发待办，不宣称全部清零。B-0002/B-0004–B-0010、T-1832真实Protyle性能、T-3220/3221研究继续保留；不开放原地排版或插件专属撤销。

# 当前有效交接（2026-10-04 T-3233–T-3235 代码完成，T-3220 证据校正）

本条是当前续跑入口；下方旧交接保留当时记录，以本条和执行板为准。

- T-3233/D-0079：阅读页签 j/k/e/m/x/?、可见键盘帮助与焦点入口、伴生栏收起/恢复偏好已实现；不接管输入/编辑/IME/菜单/弹窗。修复上下文、状态/评分、快照、AI 结果和下一篇操作的跨文章竞态，旧操作只完成原目标，不能污染当前文章。大纲定位失败打开原块。
- T-3234/D-0080：侧栏四组折叠记忆，站点/用户标签/AI 标签显示全部/Top8，当前项超出Top8或已消失仍可清除，超过15项可会话内过滤；按组增量串行保存，用户/AI 标签不混合。
- T-3235/D-0081：发现并修复同 sort 标题按随机 ID 乱序。SQL 游标只取全，原生 getChildBlocks 顺序决定大纲，非标题容器遍历、源变化/缺项/循环/预算/切文失效均拒绝部分结果，失败可重试。只读 spike 及生产服务验证通过：3.8.6，`C:\Users\sunku\AppData\Local\Temp\siyuan-glean-outline-1791103982652-23200`。该只读 API 不解除原文事务限制。
- T-3220 探针修复：删除虚构 SQL 邻接列，不再覆盖 SQL parent_id；原生 `.sy` 父级/邻接、SQL 章节父级与 API 列表投影分别记录，ID 集合比较与顺序分开。固定普通叶段落/标题样本，undo/redo 内层失败、同块恰好一个标记、HTTP 状态及代理清理均严格校验；真实PNG替代旧版伪图片字节。
- 严格探针通过：3.8.6，`C:\Users\sunku\AppData\Local\Temp\siyuan-glean-t3220-1791103361350-5936`，结果在 `transaction-report.json`，尾日志在 `kernel-tail.log`。源列表保留其他项时，嵌套项跨父级移动/恢复保持原生树关系、ID/IAL/根属性；真实PNG写入/覆盖/恢复按字节读回，跨笔记本引用列出。同块冲突本次为B，但胜者不保证。更深子树、最后一项导致空列表删除、权限/删除、双编辑器和真实宿主撤销未验证。
- 工程门禁：`pnpm test` **666/666**；`pnpm check` **0错误/0警告**；生产构建及产物门禁通过；合成性能和视觉登记通过，视觉仍 **0/24** 真宿主图。本地 `package.zip` **266970B**，构建时间 **2026-10-04 16:55:17**，版本保持1.1.0，未提交/发布。
- 下一步仍有可开发主任务：工作台就地只读预览（T-1827–T-1832）、筛选操作密度（T-1807/T-1808）、来源作者手填保护（T-1811起，先契约）、只读备份与受冲突保护的恢复（T-1780）。真实宿主/模型/外部导入/双插件/发布仍回填 B-0002/B-0004–B-0010；不要把历史池或本轮代码状态当作全部验收完成。

# 当前有效交接（2026-10-04 T-3220 并发、嵌套重排与资源写入样本完成）

- `pnpm spike:transactions` 最新通过：隔离思源 `3.8.6`、独立工作区 `C:\Users\sunku\AppData\Local\Temp\siyuan-glean-t3220-1791075966705-12088`，未触碰作者实例；新增两个 API 客户端更新不同叶块并发，双方均可读回并完成 undo/redo，并验证 `/api/file/putFile` 资源字节读回及两个笔记本的引用列表。
- 同块并发从同一旧 DOM 出发，最终只保留一个标记（本次为客户端 B），已记录为必须读回核对、禁止自动重发/覆盖的冲突边界。嵌套 `NodeList` 间单个列表项移动保持 ID、根属性和用户 IAL，直接 `moveBlock` 不进 undo。
- 该样本不等价于双 Protyle 编辑器；恢复到原嵌套位置、更深子树重排、用户中间编辑、真实网络故障、资源权限/覆盖/删除和真实宿主撤销仍未证实。继续不新增生产原文事务 API、不开放原地排版和插件专属撤销。
- 证据已同步 `D-0077`、`D-0078`、`DATA-CONTRACT §5.3`、`FORMATTING-RESEARCH §2.6`、`PROGRESS` 和 `TODO`；下一步优先处理剩余可独立验证的 T-3220 边界，真实宿主/模型/双插件验收继续归 B-0002/B-0004/B-0008。

# 当前有效交接（2026-10-04 T-3221 图片隐私边界同步，T-3220 事务研究继续）

- T-3221 代码侧边界已闭合：排版 AI prompt 对图片只发送 `[image]`，不发送 URL、alt、文件名、外链参数、图片字节或 base64；AI 计划不能直接提交图片清理，默认候选仍需用户手动选择并只作用于独立整理稿。
- 已同步 D-0076、DATA-CONTRACT §3.4、TODO、PROGRESS；排版定向测试 **46/46**、全量 `pnpm test` **650/650**、`pnpm check` 0 错误/0 警告，未调用真实模型。
- T-3221 仍待真实多模态通道、资源权限和模型效果验收；不能用文本模型、静态测试或图片文件名推断“无意义图片”。
- T-3220 探针辅助函数现准确保留块端点返回的空 `rootID`；撤销调用仍明确使用文档根 ID。最新隔离样本确认同级 `moveBlock` 保留块 ID/根属性但不进 undo，本地 PNG、块引用和查询嵌入在叶块事务 undo/redo 后保持，响应丢失后读回确认服务端已写入且不自动重发，重启后正文/块 ID 保持而内存 undo/redo 清空；邻接经 `getBlockSiblingID` 读取，未再把 SQL 列名当作字段。双编辑器、并发、真实网络故障、复杂重排、资源写入和真实宿主撤销继续未验证，不新增生产原文事务 API。

# 当前有效交接（2026-10-04 T-3220 事务 spike 扩展完成，生产原文应用仍禁止）

- `scripts/spike/transaction-spike.mjs` 已扩展并通过 `pnpm spike:transactions`：隔离思源 `3.8.6`、独立临时工作区 `C:\Users\sunku\AppData\Local\Temp\siyuan-glean-t3220-1791069788060-17848`、回环端口，未触碰作者实例。
- 新证据：`insertBlock`/`deleteBlock` 直接落盘但不改变文档 `undoState`；使用其返回的原生操作和显式逆操作包装成单个 `/api/transactions` 后，插入/删除可撤销/重做且既有块 ID 保持；已有标题 `h1→h3` 事务保留标题 ID/用户 IAL 并可撤销/重做；普通段落请求标题层级端点返回空事务。
- 原有证据仍通过：叶块与嵌套列表容器更新、复杂结构身份/引用、同事务失败、请求级部分提交、跨 session 栈顶撤销。最新探针完整输出已同步 DATA-CONTRACT §5.3、D-0075、FORMATTING-RESEARCH §2.6、PROGRESS 和 TODO。
- T-3220 仍进行中：容器重排、块嵌入/真实资源、双编辑器/并发、响应丢失、重启和真实宿主撤销待验证；不新增生产 API，不开放原地排版，不提供插件专属撤销按钮。

# 当前有效交接（2026-10-04 T-3220 首轮事务 spike 完成，复杂样本待续）

- 新增 `scripts/spike/transaction-spike.mjs` 与 `pnpm spike:transactions`；隔离内核 `3.8.6`、独立临时工作区、回环端口，未触碰作者实例。
- 实证：`updateBlock` 保留普通叶块 ID/根属性但不进入撤销栈；在含嵌套列表、代码、公式、表格、图片引用、块引用和跨文档引用的复杂文档中，原生 `/api/transactions` 只更新一个叶块时保留复杂树 ID 集合、根属性、叶块用户 IAL 和引用，并可撤销/重做；嵌套列表容器单独更新时 11 个块的 ID、邻接和用户 IAL 也保持；同事务有效更新加不存在块的样本未留下首个更新，但同一请求的多个 Transaction 出现第一个有效更新已落盘、第二个非法更新未落盘；跨 session 仍按文档栈顶撤销。
- 契约/决策/研究/任务/进度已同步：DATA-CONTRACT §5.3、D-0075、FORMATTING-RESEARCH §2.6、T-3220。没有新增生产 API 或原地排版入口。
- T-3220 仍进行中：复杂容器、引用/资源、双编辑器、并发、响应丢失、重启和真实宿主撤销待验证；继续沿用 T-3219 独立整理稿，不提供插件专属撤销按钮。

# 当前有效交接（2026-10-04 T-3229–T-3232 代码完成，真实宿主/文件验收待回填）

- 阅读页签新增真实标题块大纲：`api/client.ts` 以 `sort,id` 游标读取 `h1`–`h6`，`services/outline-service.ts` 分页，`ReaderTab.svelte` 在真实 Protyle DOM 中定位，找不到节点时打开原文；旧文档/销毁结果会丢弃。
- 阅读外观只作用于页签宿主，`ui-prefs.json` 记录字号、行距、栏宽、主题；保存视图记录最多 20 个白名单筛选和 list/kanban 布局，默认/删除/重载已接入，偏好保存按插件实例串行化。
- 设置页新增完整对账 CSV 和匿名诊断下载。CSV 只包含有效非 internal 文章属性，标签分列、未知为空、公式防护；诊断没有标题、路径、ID、URL、标签内容、正文、密钥或模型地址。
- 本轮本地回归为 `pnpm test` **649/649**、`pnpm check` 0 错误/0 警告；隔离内核 `s1-flow.mjs` **23 条主链通过**，包含 heading SQL、CSV 与匿名诊断；未提交、未打 tag、未发布、未提交集市。
- 生产构建已通过，`package.zip` **262410B**，真实构建时间 **2026-10-04 06:16:18**；仅有既有 `inlineDynamicImports` 弃用提示。
- 下一步：在隔离 3.8.6 内核确认 heading SQL 返回/游标和导出入口可用；作者真实验收大纲滚动、页签样式、保存视图重载、下载文件及移动/读屏仍归 B-0002/B-0005。

# 当前有效交接（2026-10-04 T-3222–T-3228 代码与隔离验证完成，真实验收待回填）

- 全库摘录、阅读回顾和对外桥接已实现：入口分别在 `HighlightView.svelte`、`StatsView.svelte`、`services/bridge.ts`；契约为 D-0064–D-0066，使用说明见 `docs/HIGHLIGHTS.md`、`docs/READING-REVIEW.md`、`docs/BRIDGE.md`。
- 全库摘录只收已确认非 internal 文章，根 ID 分批 ≤200、块页 ≤500，导出前校验源块；回顾按可信完成时间提供周/月/年和逐日热力图；桥接读投影脱离引用，写入默认关闭。
- AI 总结/翻译/富化/排版共享队列和额度，语义建议回读属性排除候选、普通笔记、internal；新用户查重、相关旧文、预置动作和排版均默认关闭，非法开关不放行。选区校验完整正文宿主边界，三画布配额/超龄/候选提示共用。
- 隔离内核 `scripts/e2e/s1-flow.mjs` 通过 **21** 条主链，包含桥接真实读写/卸载、摘录源变更阻断、回顾报告、501 条摘录跨页；`pnpm test` **641/641**、`pnpm check` 0 错误/0 警告。
- 仍未关闭：B-0002 真实宿主/移动 UI，B-0004 真实模型，B-0008 双插件联调；T-3220 原文事务/撤销和 T-3221 图片语义仅完成研究，不能伪标完成。未提交、未打 tag、未发布。

# 当前有效交接（2026-10-04 T-3219 排版优化代码与隔离验证完成，真实宿主/模型待验收）

- 新功能入口在原生阅读上下文与桌面阅读页签的“排版优化”。基础整理可直接使用；设置新增 `ai.formattingEnabled=false`，开启并保存后，弹窗可手动执行 AI 结构排版。契约见 DATA-CONTRACT §3.4、D-0063，完整使用/失败/验收边界见 `docs/FORMATTING.md`。
- 域层 `formatting.ts` 保护复杂导出 Markdown，仅缩短链接显示/收束普通空行；推广/重复图片/无说明图片默认不选，乱码只提示。AI 严格校验标题/清理编号 JSON，不生成替换正文；使用已有通道、共享串行队列、额度和日志，全文超 24k 字符/400 段明确降级。
- 服务层 `formatting-service.ts` 只在用户确认后保存独立普通整理稿，原文/属性不改；原文/元数据变更校验，建稿后保留 ID 重试标记/索引，创建结果未知不再建。预览/选择/恢复令牌仅存本次弹窗；关闭后应先检查原笔记本已有整理稿。
- 真实内核曾暴露默认导出附带 YAML/标题和块链转换问题；已先验证再固定 `{yfm:false, addTitle:false, refMode:2}`，不改全局配置。新稿不复制原生块 ID/IAL，不宣称无损原生复制。根块标题读取的 SQL 别名错误也已修正。
- 最终门禁：新增排版回归 **45/45**，全量 **500/500**、`pnpm check` 0 错误/0 警告、`pnpm build`、性能/视觉登记/产物门禁与 diff 检查通过；隔离内核 `3.8.6` 服务 E2E **17 条主链通过**。本地 `package.zip` **240343B**，构建时间 **2026-10-04 04:48:48**；版本保持 `1.1.0`。
- T-3219 保持三态中的真实验收待办：B-0002 主机/移动端入口、对照、焦点、图片/稿件显示；B-0004 真实官方/自定义模型计划与降级。视觉矩阵 24 个宿主截图仍未采集。当前环境没有真实模型证据，不把单测或内核结果当作真实 AI 效果。
- 下一步按执行板回填真实验收/修复实际反馈；T-3220 研究块级事务应用与撤销，T-3221 研究视觉模型图片语义清理，两者需各自契约/实证，不能用全文字符串替换或文件名猜测绕过。前轮未提交工作保留；本轮未提交、未打 tag、未发布、未提交集市。

# 当前有效交接（2026-10-04 T-3216–T-3218 失败恢复修复完成，真实故障验收待回填）

- 已完成三个主任务的代码与本地回归：六类恢复矩阵/导入失败项重试（T-3216）、宿主异步传输与外部响应校验（T-3217）、后台刷新和未成功选择保留（T-3218）。决策为 D-0060–D-0062。
- 导入保留失败 URL 与已返回文档 ID，收录失败复用原文档，索引失败只修复缓存；笔记本加载可保留预览重试。失败记录只在当前弹窗内存中，关闭后应核对目标笔记本半成品。
- 所有 JSON/multipart 请求统一经 SDK 异步 `fetchSyncPost` 与 `kernelPost` 校验；非零/异常响应正常拒绝，云列表内层错误不会伪装为空列表，云删除/资产失败不会显示成功。已核对思源 v3.8.6 源码，没有新增端点或文章/saveData 字段。
- 已有索引时刷新保留列表/看板/收集箱 DOM；并发请求串行合并补跑；批量部分成功只移除成功选择且防重入。云端删除失败保留条目，并提供单独删除重试和本地文章入口。
- 最终门禁：`pnpm test` **455/455**、`pnpm check` 0 错误/0 警告、`pnpm build`、`pnpm perf:check`、`pnpm visual:check`、`pnpm check:release` 与 `git diff --check` 通过；隔离内核 `3.8.6` 的 S1–S4 服务级 E2E **16 条主链全部通过**。当前 `package.zip` **231615B**，真实构建时间 `2026-10-04 04:01:27`（本地）。
- 视觉登记仍为 **0 张已采集/24 张待真实宿主**；真实断网、权限、焦点/滚动、AI、外部文件、订阅、assets 和双插件结果继续回填 B-0001/B-0002/B-0004–B-0008。T-3194 代码修复已并入 T-3218，真实滚动/草稿结果未关闭。
- 后续按当前执行板处理真实验收反馈和失败根因；历史需求池不是已交付功能。工作区包含前轮未提交修改，保留它们；本轮未提交、未打 tag、未发布、未提交集市。

# 当前有效交接（2026-10-04 T-3214 摘录制卡闭环修复完成，真实闪卡复习待验收）

- 根因已修复：`insertBlock` 不保证返回嵌套列表项 ID，旧实现依赖最终一致性 SQL 找回列表项，导致隔离尖刺出现 `8/9` 假失败。
- 当前制卡为外层列表项预分配合法 `data-node-id`；API 层提取全部事务 ID，服务优先采用事务回传的目标 ID，否则使用已提交 DOM 的显式 ID，并保留 SQL 兼容回退。
- 新增 `node scripts/spike/glean-spike.mjs --only=flashcard`；定向制卡 `1/1`，完整 `pnpm spike` 已恢复 `9/9`。决策记录为 D-0058，任务记录为 T-3214。
- 本轮仍未提交、未打 tag、未发布、未提交集市；作者需在真实闪卡复习界面核对正背面、来源和重复制卡，归属 B-0002。
- 文档同步前的最终门禁已通过；本次记录同步只更新验证数字，不改变代码。门禁结果为 `pnpm test` 425/425、`pnpm check` 0 错误/0 警告、`pnpm build`、`pnpm perf:check`、`pnpm visual:check`、`pnpm check:release` 和 `git diff --check` 全部通过。

# 当前有效交接（2026-10-04 T-3215 状态表达与无障碍偏好完成，真实系统走查待验收）

- 状态徽章现在同时表达颜色、图形和文字；面板/页签统一有键盘 `:focus-visible` 轮廓，并支持 `prefers-reduced-motion`、`prefers-contrast` 和 `forced-colors`。
- 定向无障碍回归 25/25，全量 `pnpm test` 425/425，`pnpm check` 0 错误/0 警告，`pnpm build` 通过；未新增文章属性、saveData 字段、端点或 i18n 键。
- 决策记录为 D-0059，旧待办 T-3191/T-3192 已并入 T-3215；真实系统主题、读屏和键盘-only 走查归 B-0002。

# 当前有效交接（2026-10-04 T-3213 发布候选静态复核完成，等待真实验收与授权）

- 本轮完成主任务 `T-3213` 的本地候选复核：新增 `docs/RELEASE-CANDIDATE.md` 与 `tests/release-candidate.test.ts`，核对版本 `1.1.0`、CHANGELOG、构建/发布门禁、媒体手册和能力矩阵口径。
- `pnpm check:release` 通过，当前构建 `package.zip` 为 230507B，`dist` 资源、图标和预览尺寸均通过；修正媒体手册旧的 `v1.0.0` 版本命令。
- 真实截图/GIF、隔离工作区覆盖安装/重启、卸载重装属性保留和 B-0001/B-0002/B-0004–B-0008 仍需作者操作；tag、GitHub Release、集市 PR 未执行，必须逐次授权。
- 当前执行板无可独立完成的代码主任务；若继续自动推进，应先处理作者真实验收结果，或在新需求进入后建立下一主任务。不提交、不打 tag、不发布、不提交集市。

# 当前有效交接（2026-10-04 T-3212 外部联调矩阵完成，真实环境待操作）

- 本轮完成主任务 `T-3212` 的联调准备：新增 `docs/INTEGRATION-ACCEPTANCE.md`，固定 `INT-01`–`INT-04` 四条外部链路、`INT-F01`–`INT-F08` 失败样本、结果记录模板和数据主权边界。
- 新增 `tests/integration-acceptance.test.ts` 并加入 `pnpm test`，锁定导入、收集箱、快照和打卡桥的实际服务/API/domain 入口与去重、失败、恢复语义。
- 已同步 `docs/ACCEPTANCE.md`、`docs/BLOCKERS.md`、`docs/PROGRESS.md`、`docs/DECISIONS.md` 和 `TODO.md`；B-0005–B-0008 仍活跃，真实导出文件、订阅、assets 和双插件操作需作者回填。
- 下一主任务为 `T-3213` 发布候选复核；不提交、不打 tag、不发布、不提交集市。

# 当前有效交接（2026-10-04 T-3211 AI 验收矩阵与失败样本库完成，真实模型待验收）

- 本轮完成主任务 `T-3211` 的代码侧验收准备：新增 `docs/AI-ACCEPTANCE.md`，固定 `AI-01`–`AI-09` 主流程、`AI-F01`–`AI-F09` 失败样本、结果模板、数据主权抽查和官方/自定义通道前置条件。
- 新增 `tests/ai-acceptance.test.ts` 并加入 `pnpm test`，锁定文档与富化、伴读、自定义通道、预置动作、智能体工具和 AI 设置入口的对应关系；没有把隔离测试写成真实模型质量证据。
- 已同步 `docs/ACCEPTANCE.md`、`docs/BLOCKERS.md`、`docs/PROGRESS.md`、`docs/DECISIONS.md` 和 `TODO.md`；B-0004 仍活跃，真实模型、嵌入、自定义通道和额度操作需作者按矩阵执行。
- 下一主任务为 `T-3212` 导入/收集箱/快照/打卡桥真实联调准备；不提交、不打 tag、不发布、不提交集市。

# 当前有效交接（2026-10-04 T-3210 阅读器与摘录线逐页验收完成）

- 本轮完成主任务 `T-3210`：新增 `docs/READER-ACCEPTANCE.md` 与 `tests/reader-acceptance.test.ts`，覆盖正文缺失、原文降级、选区摘录、制卡、回跳、移动动作面和快照/状态边界。
- 修复 `ReaderTab.svelte` 重复渲染“读完并下一篇”；快照图标补可访问名称；`ReadingContext` 移动动作条补 44px 命中区，核心动作仍默认可见。
- 定向阅读器回归 9/9、`pnpm check` 0 错误/0 警告；真实 Protyle/riff/移动设备/assets 验收继续归 B-0002/B-0006。
- 下一主任务为 `T-3211` AI 真实模型验收与失败样本库；不提交、不打 tag、不发布、不提交集市。

# 当前有效交接（2026-10-04 T-3209 中英文文案与术语终审完成）

- 本轮完成主任务 `T-3209`：新增 `docs/TERMINOLOGY.md` 与 `tests/terminology.test.ts`，锁定五态、候选/来源证据、移动端、撤销、失败、离线、重试和今日拾遗的双语语义。
- 修正英文统计 `0k`、完成统计单位 `done`、过时 M3 能力提示、`Glean` 视图名和 `Dusting` 超龄文案；中英文 i18n 键集合仍一致。
- 下一主线为 `T-3210` 阅读器与摘录真实/逐页验收；代码侧 T-3208/T-3209 已完成，真实桌面/移动文案走查继续归 B-0002。
- 真实环境 blocker 仍未代替作者执行；不提交、不打 tag、不发布、不提交集市。

# 当前有效交接（2026-10-04 T-3208 对外能力承诺审查完成）

- 本轮完成主任务 `T-3208`：新增 `docs/CAPABILITY-MATRIX.md`，覆盖代码完成、隔离验证、真实状态、前置条件、失败降级和对外口径。
- `README.md`、`README.en-US.md`、`plugin.json`、中英文设置/首启能力卡和 `docs/RELEASE-MEDIA.md` 已收紧；AI 明确为可选、默认手动、需配置模型，收集箱/导入/快照/打卡桥/移动端均保留真实验收边界。
- 新增 `tests/capability-matrix.test.ts` 并纳入 `pnpm test`；下一步先跑完整门禁，再推进 `T-3209` 中英文术语终审。
- 真实环境仍由 `B-0001/B-0002/B-0004–B-0008/B-0009/B-0010` 覆盖；不提交、不打 tag、不发布、不提交集市。

## 当前有效交接（2026-10-04 T-3207 数据主权与错误路径审计完成，真实宿主复测待验收）

- 本轮修复智能体超龄归档的真实成功数误报：现在返回 `attempted`、`archived`、`failed` 和 `succeeded`，失败项不会被报告为已归档。
- 命令入口手动状态、手动收录、右键收录和设置重建索引增加异常反馈；新增静态门禁确认属性写端点不绕过 `clip-store`，新增清空派生索引后属性恢复回归。
- 代码/静态测试通过后，仍需作者在真实宿主做卸载/重装、清空 saveData、内核断开和批量部分失败复测；下一主任务为 `T-3208` 对外能力承诺审查。

## 当前有效交接（2026-10-04 T-3206 大库性能基线完成，真实宿主性能待验收）

- 本轮完成主任务 `T-3206` 的代码和合成基线：`pnpm perf:baseline`/`pnpm perf:check` 覆盖 1k、5k、10k 文档的扫描、索引重建、筛选/分面、导入解析和今日拾遗。
- 最近一次 `perf:check` 通过；10k 规模扫描约 32ms、重建约 365ms、筛选/分面约 24ms、导入解析约 569ms、重浮约 17ms。结果只作当前机器回归护栏，不承诺作者机器同样毫秒数。
- 分页上界、200 条属性批量上界、结果完整性和中位耗时均有自动校验；真实思源 UI 渲染、长文切换和外部导出文件导入仍分别归 B-0002/B-0005。
- 下一主任务为 `T-3207` 数据主权与错误路径审计；若作者先回传大库实测数据，先对照报告定位退化再调整阈值或实现。

## 当前有效交接（2026-10-03 T-3205 视觉回归矩阵完成，真实宿主截图待验收）

- 本轮完成主任务 `T-3205` 的代码与协议部分：固定 3 种视口 × 8 种状态的 24 个视觉案例，登记文件为 `docs/visual-regression/baseline.json`，校验器为 `pnpm visual:check`。
- 普通检查允许案例保持 `pending-host`，严格检查 `pnpm visual:check -- --strict` 要求截图已由真实思源桌面宿主或作者真机采集，并验证 PNG 尺寸；设计原型不被当作实现截图。
- 录屏只补充滑动、焦点、加载、失败和撤销等动态路径，临时文件放 `output/visual-regression/`；真实采集和视觉差异审阅仍归 B-0002，纯浏览器限制见 B-0009/B-0010。
- 下一主任务为 `T-3206` 大库性能基线；若作者先回传视觉截图，则先回填 manifest、运行严格检查并记录差异。

## 当前有效交接（2026-10-03 T-3183 触控目标完成，待真机验收）

- 本轮完成主任务 `T-3183`：窄屏和移动弹窗的主要交互控件统一补齐 44×44px 命中区；设置开关保留 36×21px 视觉轨道，使用 44px 命中盒承载。
- 变更集中在 `src/index.scss` 与 `tests/mobile-nav.test.ts`，不新增文章属性、saveData 字段、端点或 i18n；定向测试 18/18，`pnpm check` 0 错误、0 警告。
- 真机仍需验证相邻控件误触、开关视觉密度、系统大字/显示缩放、320–420px 窄屏和弹窗内实际触控范围，继续并入 B-0002。
- 随后已完成 `T-3202` 隔离内核 S1–S4 主链重跑；下一主任务为 `T-3185`，真实环境验收继续由 B-0001/B-0002/B-0004–B-0008 覆盖。

## 当前有效交接（2026-10-03 T-3184 与 T-3202 完成，待真实环境验收）

- 本轮补充移动端候选卡默认显示收录、补 URL、本地收录、排除和选择动作；选择框容器使用 44×44px 命中区，桌面端 hover 收束保持不变。决策见 `D-0046`。
- 隔离内核 `3.8.6` 主链 E2E 已通过，覆盖候选、迁移、状态、导入、四载体、今日拾遗、筛选、索引重建和数据主权；当前完整测试 **382/382**，`pnpm check`、`pnpm build`、`git diff --check` 通过。
- 下一主任务为 `T-3185`：补齐移动端网络/内核不可用时的提示、重试、缓存降级和不伪造成功路径。作者真机/真实服务验收仍由 B-0001/B-0002/B-0004–B-0008 覆盖。

## 当前有效交接（2026-10-03 T-3185 移动端离线反馈完成，待真机验收）

- 本轮补充移动端 `online`/`offline` 状态监听：离线时顶部显示离线，已有索引内容继续可查看，并提供重试入口；读库扫描失败保留旧索引。
- 收录、状态、优先级和评分写入失败时，离线状态显示连接恢复后重试；不新增文章属性、saveData 字段或端点。决策见 `D-0047`。
- 定向测试 24/24、i18n 回归、`pnpm check` 通过；完整测试/构建待最终门禁收尾。下一主任务为 `T-3186`，整理真机/真内核验收阻塞项。

## 当前有效交接（2026-10-03 T-3186 验收分工完成，等待作者真实环境操作）

- `docs/BLOCKERS.md` 已增加验收分工表：移动端、桌面主链、官方剪藏、真实 AI、外部导入、快照/收集箱/打卡桥分别列出“我已完成”和“作者仍需操作”。
- 推荐的下一步已经全部落地：T-3183 触控区、T-3184 非 hover 动作、T-3185 离线反馈、T-3202 隔离主链、T-3186 验收分工均已完成代码/文档工作。
- 最终门禁：`pnpm test` **384/384**、`pnpm check` 0 错误/0 警告、`pnpm build` 通过、`git diff --check` 通过；build 仅有既有 `inlineDynamicImports` 弃用提示。
- 现在主要等待作者执行 B-0001、B-0002、B-0004–B-0008；未收到真实结果前不发布、不打 tag、不提交集市。收到反馈后按“根因→修复→回归→记录”继续推进。

## 当前有效交接（2026-10-03 质量审查与待办重排完成）

- 本轮完成主任务 `T-3203`：审查当前实现质量，确认 `pnpm test` **380/380**、`pnpm check`、`pnpm build`、`git diff --check` 通过；新增 `docs/QUALITY-AUDIT-2026-10-03.md`。
- 当前实现的主要优点是数据主权、分层边界、候选/迁移/导入/AI 回归和移动端静态契约覆盖完整；主要缺口是作者真实环境三态验收、移动触控 44px、离线恢复、无障碍运行时、视觉回归和大库性能证据。
- `TODO.md` 顶部新增当前执行板：先做 T-3183–T-3186，再做 T-3202–T-3209，最后才推进 T-3210–T-3213；旧 T-18xx–T-30xx 保留为需求池，不作为下一轮隐含承诺。
- 决策记录为 `D-0044`：任务关闭必须分开记录代码、隔离验证、作者真实环境验收，不能用静态测试替代真机/真实内核/真实 AI。
- 下一主任务：`T-3183` 验证所有触控目标不小于 44×44px；随后应完成 `T-3202` 隔离主链重跑。继续不提交、不打 tag、不发布、不提交集市。

## 当前有效交接（2026-10-03 T-3182 移动端响应式布局完成，待真机验收）

- 本轮完成主任务 `T-3182`：移动 Dock 集中定义 `env(safe-area-inset-*)` 安全区变量，顶部栏、底栏、内容滚动区、筛选抽屉和移动弹窗按边缘分别避让；底栏空间继续合并 D-0042 的键盘 inset。
- 横屏且高度不超过 560px 时收紧顶部与筛选抽屉纵向占用，并限制更多菜单滚动高度；420px 窄屏时压缩间距、收窄任务状态和操作区，长标题/摘要/行标题/设置说明/筛选标签允许换行，不隐藏业务状态。
- 本轮只改 `src/index.scss` 和 `tests/mobile-nav.test.ts`，不新增文章属性、saveData、端点或 i18n；决策见 `docs/DECISIONS.md` 的 D-0043。定向测试 12/12，完整 `pnpm test` 380/380，`pnpm check`、`pnpm build`、`git diff --check` 已通过；build 仅有既有 `inlineDynamicImports` 弃用提示。
- 真机核对加入 B-0002/`docs/ACCEPTANCE.md` 2.25；下一主任务候选为 `T-3183`（验证所有触控目标不小于 44×44px）。不发布、不打 tag、不提交集市。

## 当前有效交接（2026-10-03 T-3181 移动端键盘视口避让完成，待真机验收）

- 本轮完成主任务 `T-3181`：新增纯视口计算和共享 `visualViewport` 适配器，键盘高度只作为临时 CSS 变量，不进入文章属性、saveData 或端点。
- 移动 Dock 底栏随键盘上移；图书馆列表、统计、今日拾遗和工作台滚动区预留安全余量；筛选抽屉整体抬升并保留内部滚动。
- `simpleDialog` 统一给设置、导入、迁移、首启和其他插件弹窗挂载视口监听；弹窗内容限制到可见视口高度，设置底部操作栏和各滚动容器增加键盘余量。无 `visualViewport` 时退回原有安全区与滚动行为。
- 移动入口仍由 `getFrontend()` 判定，桌面端不启用；决策见 `docs/DECISIONS.md` 的 D-0042。完整 `pnpm test` **378/378**，`pnpm check` 0 错误/0 告警，`pnpm build`、`git diff --check` 通过；build 仅有既有 `inlineDynamicImports` 弃用提示。
- 真机核对加入 B-0002/`docs/ACCEPTANCE.md` 2.24；下一主任务候选为 `T-3182`（安全区、横屏、窄屏和大字体布局）。不发布、不打 tag、不提交集市。

## 当前有效交接（2026-10-03 T-3180 移动端卡片滑动与撤销完成，待真机验收）

- 本轮完成主任务 `T-3180`：移动端今日拾遗卡增加可发现的横向手势，向右执行“改天”，向左执行“归档”；原有“标记已读 / 改天 / 归档”显式按钮保持不变，桌面端不启用手势。
- 手势只在 `facade.isMobile` 分支生效，垂直位移更大或未达到阈值时交还滚动；卡片位移、方向标签、双语提示、撤销条和 44px 触控目标均使用现有 b3/`glean-*` 主题体系。
- `actOnSurface` 现在通过 `readClip` 捕获动作前状态并返回前后令牌；`undoSurfaceAction` 回读当前文档，状态未被外部改变才恢复，否则静默保留新状态并显示不可撤销提示。所有属性写入仍经 `clip-store`，没有新增数据契约、saveData 或端点。
- 静态回归加入 `tests/mobile-nav.test.ts`；完整 `pnpm test` **376/376**，`pnpm check` 0 错误/0 告警，`pnpm build`、`git diff --check` 通过；build 仅有既有 `inlineDynamicImports` 弃用提示。
- 真机核对加入 B-0002/`docs/ACCEPTANCE.md` 2.23；下一主任务候选为 `T-3181`（键盘弹出时输入框、按钮和底部导航不遮挡）。不发布、不打 tag、不提交集市。

## 当前有效交接（2026-10-03 T-3179 移动端筛选抽屉完成，待真机验收）

- 本轮完成主任务 `T-3179`：移动端图书馆筛选改为底部抽屉，抽屉内编辑独立草稿，提供明确的应用、清空、关闭和遮罩退出路径，并显示当前已应用结果数。
- 抽屉草稿复用既有站点、用户标签、AI 标签、入口来源、时间来源、内容类型、排序和方向；只有点击应用才写回现有筛选状态，清空只重置草稿，关闭/遮罩不会丢弃已应用条件。关键词搜索仍由顶部搜索框独立控制。
- 结果计数始终来自当前 `rows`，不根据未应用草稿预演；筛选继续只改变内存视图，不写 `custom-clip-*`、saveData 或新端点，桌面即时筛选逻辑未复制或改写。决策见 `docs/DECISIONS.md` 的 D-0040。
- 抽屉使用双语 i18n、原生控件、ARIA dialog/status、b3 主题变量、安全区内边距、内部滚动和 44px 触控目标；静态回归加入 `tests/mobile-nav.test.ts`。代码验证：完整 `pnpm test` **374/374**，`pnpm check` 0 错误/0 告警，`pnpm build`、`git diff --check` 通过；build 仅有既有 `inlineDynamicImports` 弃用提示。
- 真机核对加入 B-0002/`docs/ACCEPTANCE.md` 2.22；下一主任务候选为 `T-3180`（卡片滑动操作的可发现性和撤销）。不发布、不打 tag、不提交集市。

## 当前有效交接（2026-10-02 T-3178 移动端顶部操作完成，待真机验收）

- 本轮完成主任务 `T-3178`：移动端 Dock 顶部显示当前视图标题、读库数量、返回入口、更多菜单和同步状态。
- 返回只在已有子视图时回到 `resurface`，不接管思源系统历史；更多菜单只调用现有刷新、工作台、整理剪藏库、外部导入和设置 facade，不新增流程或存储。
- 同步状态来自真实 `loading`/`loadError`/就绪分支，并保留原有缓存降级与重试横幅；没有新增文章属性、saveData 字段或端点。
- 顶部操作使用双语 i18n、原生按钮、ARIA menu/status、b3 主题变量和 44px 触控目标；静态回归继续归入 `tests/mobile-nav.test.ts`。决策见 `docs/DECISIONS.md` 的 D-0039。
- 代码验证：完整 `pnpm test` **372/372**，`pnpm check` 0 错误/0 告警，`pnpm build`、`git diff --check` 通过；build 仅有既有 `inlineDynamicImports` 弃用提示。真机核对加入 B-0002/`docs/ACCEPTANCE.md` 2.21；下一主任务候选为 `T-3179`。不发布、不打 tag、不提交集市。

## 当前有效交接（2026-10-02 T-3177 移动端底部导航完成，待真机验收）

- 本轮完成主任务 `T-3177`：移动端 Dock 显示首页、图书馆、摘录、设置四项底部导航；桌面端继续使用原有四视图分段控件。
- 首页映射 `resurface`，图书馆映射 `library`，摘录映射 `highlights`；设置直接复用 `facade.openSettings()` 和既有 `SettingsView` 草稿弹窗，不复制状态、不写文章属性或新增插件存储。
- 底栏按 `facade.isMobile` 渲染，移动判定仍来自 `getFrontend()`；原生按钮带 `aria-current`，最小触控高度 48px，预留底部安全区。决策见 `docs/DECISIONS.md` 的 D-0038。
- 静态契约见 `tests/mobile-nav.test.ts`；验证：完整 `pnpm test` **370/370**，`pnpm check` 0 错误/0 告警，`pnpm build` 通过（仅有既有 `inlineDynamicImports` 弃用提示），`git diff --check` 通过。
- 作者真机核对加入 B-0002/`docs/ACCEPTANCE.md` 2.20；本轮后续主任务为 `T-3179`（移动端筛选抽屉、应用、清空和结果计数）。不发布、不打 tag、不提交集市。

## 当前有效交接（2026-10-02 T-3176 设置与首启可访问性/窄屏路径完成，待真机验收）

- 本轮完成主任务 `T-3176`：设置页和首启向导补齐标题/分组语义、笔记本选中态、扫描失败/进行中/保存状态播报，以及根容器忙碌态。
- 设置数值、文本和打卡选择控件补充 `aria-label`；分段控件标为命名 group；首启步骤进度通过双语隐藏 live region 播报。
- 窄屏 CSS 让首启操作区和设置底部操作栏换行，宽输入框按容器收缩；移动端自动首启仍由 `getFrontend()` 守门，没有改变数据契约或存储。
- 决策见 `docs/DECISIONS.md` 的 D-0037；静态门禁见 `tests/accessibility.test.ts`；真机键盘/读屏/触控检查加入 B-0002 与 `docs/ACCEPTANCE.md` 2.19。
- 验证：完整 `pnpm test` **368/368**，`pnpm check` 0 错误/0 告警，`pnpm build` 通过（仅有既有 `inlineDynamicImports` 弃用提示），`git diff --check` 通过；不发布、不打 tag、不提交集市。
- 下一主任务候选为 `T-3177`（移动端底部导航），但先保留 T-3176 真机验收项，不以静态门禁冒称平台验证。

## 当前有效交接（2026-10-02 T-3175 首次使用后的引导收束完成，待真机验收）

- 本轮完成主任务 `T-3175`：首启完成/跳过会自动隐藏设置页新手提示；尚未完成时可点击“隐藏提示”，状态增量写入 `ui-prefs.json`。
- `onboardingHintDismissed` 由偏好规范化统一补齐；完成状态强制归一化为已隐藏，旧偏好不会因缺字段反复打扰；没有修改 `settings.json`、文章属性或扫描恢复语义。
- 设置页异步读取偏好后再显示提示，隐藏操作有保存失败反馈；提示使用 b3 主题变量和 `glean-` 类名，双语键集合保持一致。
- 决策见 `docs/DECISIONS.md` 的 D-0036；真机检查加入 B-0002/`docs/ACCEPTANCE.md`，下一主任务候选为 `T-3176`。
- 验证：完整 `pnpm test` 364/364，`pnpm check` 0 错误/0 告警，`pnpm build` 通过（仅有既有 `inlineDynamicImports` 弃用提示），`git diff --check` 通过；不发布、不打 tag、不提交集市。

## 当前有效交接（2026-10-02 T-3174 首启中断恢复、退出与重新扫描完成，待真机验收）

- 本轮完成主任务 `T-3174`：首启进度只写 `ui-prefs.json` 的 `onboardingStep`/`onboardingInterrupted`，扫描预览不落盘。
- 欢迎、选库、扫描预览和能力卡均可“稍后继续”；原生弹窗关闭也会由销毁钩子保存当前步骤。显式跳过/完成清除恢复标记。
- 插件重载时若已有锚点但引导仍未完成，仍会自动恢复；能力卡恢复统一回到扫描步，按当前设置重新扫描，避免持久化过期预览。
- “重新扫描”只读当前文档并重建派生索引，不写 `custom-clip-*`；未新增 `docs/DATA-CONTRACT.md` 字段。决策见 `docs/DECISIONS.md` 的 D-0035。
- 验证：偏好/i18n 定向 8/8；完整 `pnpm test` 363/363；`pnpm check` 0 错误/0 告警；`pnpm build` 通过（仅有既有 `inlineDynamicImports` 弃用提示）。下一主任务候选为 `T-3175`，真机验收并入 B-0002。

## 当前有效交接（2026-10-02 T-3173 首启笔记本选择、状态映射与导入确认完成，待真机验收）

- 本轮完成主任务 `T-3173`：首启选择显示已选笔记本数量；不选笔记本仍可完成只读扫描，但外部导入必须指定当前有效目标笔记本。
- 首启“导入”链接已改为 `facade.openImport()`，不再误开旧文迁移；导入器会校验首选笔记本是否仍存在，失效时回退到当前列表首项。
- 导入预览新增去重后状态汇总：外部未读/未知、已读、归档分别映射为 `inbox`、`done`、`archived`；确认勾选前不会调用 `runImport`，切换目标笔记本会清掉确认。
- 决策见 `docs/DECISIONS.md` 的 D-0034；没有新增存储字段，不需改 `docs/DATA-CONTRACT.md`。相关验收已加入 `docs/ACCEPTANCE.md` 2.12/2.16，作者真机项并入 B-0002/B-0005。
- 本轮定向导入/i18n 回归 18/18；完整 `pnpm test` 359/359，`pnpm check` 0 错误/0 告警，`pnpm build` 通过（仅有既有 `inlineDynamicImports` 弃用提示）。下一主任务候选为 `T-3174`，不以代码门禁替代作者真机验收。

## 当前有效交接（2026-10-02 T-3172 首启扫描四类预览完成，待真机验收）

- 本轮完成主任务 `T-3172`：首启扫描把范围内文档按真实属性/来源证据分为已确认读库、待确认候选、候选缺来源和普通/不纳入候选，并展示有限示例。
- 新增 `scanPreview` 服务只更新可重建的 `glean-index.json`；测试证明扫描不调用文章属性写入，候选仍须到工作台逐篇确认。决策见 `docs/DECISIONS.md` 的 D-0033。
- 首启预览补充扫描总量、四类计数、示例卡片、候选 URL/缺来源提示和窄屏布局；双语 i18n 已同步。
- 验证：首启扫描/i18n 定向回归 24/24；完整 `pnpm test` 358/358；`pnpm check` 0 错误/0 告警；`pnpm build` 通过；`git diff --check` 通过。真机 UI 仍待作者验收。
- 作者验收新增 `docs/ACCEPTANCE.md` 2.12 的四类预览核对；下一主任务候选为首启笔记本选择与导入确认（`T-3173`），不以代码通过替代真机验收。

## 当前有效交接（2026-10-02 T-3165 设置草稿闭环完成，待真机验收）

- 本轮完成主任务 `T-3165`：设置页所有偏好先进入弹窗草稿，只有显式点击保存才写入 `settings.json`；取消或直接关闭不写入。
- 恢复默认只重置草稿；测试自定义 AI、重建索引和挂载看板消费草稿，不隐式持久化设置。决策见 `docs/DECISIONS.md` 的 D-0032。
- 新增 `cloneSettings` / `mergeSettingsDraft` / `settingsEqual`，覆盖嵌套对象隔离与并发保留；中英文文案、底部 sticky 操作栏和未保存状态反馈已接入。
- 验证：设置/i18n 单测 13/13；完整 `pnpm test` 357/357；`pnpm check` 0 错误/0 告警；`pnpm build` 通过；`git diff --check` 通过。真机 UI 仍待作者验收。
- 作者验收新增 `docs/ACCEPTANCE.md` B-0002 的 2.15；下一主任务候选为首启笔记本选择与导入确认（`T-3173`），不以本轮代码通过替代真机验收。

## 当前有效交接（2026-10-02 T-1744 TTS 代码完成，等待桌面真机验收）

- 作者明确说“开发吧”，本轮按推荐顺序启动 `T-1744`；未发布新版本、未打 tag、未提交集市。
- 阅读页签已接入 Web Speech API：全文/选区朗读、暂停/继续、停止后从当前分段继续、语速 `0.75×–1.5×` 调节；移动端或无 `speechSynthesis` 时隐藏。
- TTS 仅消费当前 Protyle 正文/选区，状态是页签内存；不新增 `custom-clip-*`、不写 `saveData`、不改变五态/完成时间/正文。决策见 `docs/DECISIONS.md` 的 D-0031。
- 验证：阅读单测 6/6；完整 `pnpm test` 135/135；`pnpm check` 0 错误/39 条 Svelte 告警；`pnpm build` 通过；`git diff --check` 通过。
- 待作者验收：`docs/ACCEPTANCE.md` B-0002 的 2.14——桌面系统 voice、中文/英文发音、长文连续朗读、暂停续读、切换文档清理、移动端隐藏。当前 `T-1744` 保持 ◐，不宣称平台验收完成。

## 当前有效交接（2026-09-30 **v1.1.0 已发布**——产品重整 S1–S4 与阅读体验全链）

**作者已授权发版，v1.1.0 已上线**：https://github.com/ai68298100/siyuan-glean/releases/tag/v1.1.0 （package.zip 213KB 已附，公开可下载；tag v1.1.0 已推）。

- 定版过程：package.json/plugin.json → 1.1.0；CHANGELOG「未发布」段回填 v1.1.0（2026-09-30）；RELEASE.md 历史表已补。
- 门禁：清 dist 重建 → check:release **14/14** → check 0 错 / test 132/132 / 隔离 E2E **16/16** 全绿后才打 tag。
- 发布方式：GitHub API（凭据取自系统凭据管理器 `git credential fill`，curl 走代理；匿名 API 有限流，带认证验证）。
- **集市未提交**（需作者单独授权，流程见 RELEASE.md：fork bazaar → plugins.txt → PR）。
- 发布后仍开放的事项：作者按 ACCEPTANCE.md 真机走查（发现问题走 v1.1.1+ 补丁）；T-1601 截图/GIF（集市材料，若要提交集市才需要）。
- 注意：E2E 持久工作区 ~/SiYuan-Glean-E2E 有历史遗留空父文档「剪藏」（四篇演示文档的父），无害保留勿删。

## 当前有效交接（2026-09-30 验收驱动转型：验收手册 + 数据主权脚本化）

开发侧任务池已清空，本轮完成转型准备，门禁全绿，未发布新版本：

- **docs/ACCEPTANCE.md（作者真机验收手册）成文**：环境准备（真机装包 / `launch-e2e.mjs` 隔离联调）+ B-0001~B-0008 逐项操作步骤与预期（B-0002 拆 13 条：三画布/载体/阅读条/页签/伴生栏/AI 筛选/超龄清单/今日拾遗/命令/首启预览/移动端；B-0004 七步含额度与 off 降级）+ 问题反馈格式与"当日修复→补丁版"流程约定 + **§9 发布预检**（门禁 1/2/3 已绿；缺项=版本定版、CHANGELOG 追加、T-1601 截图、桌面/移动走查、集市授权）。BLOCKERS 头部已挂指引。
- **T-1108 数据主权用例脚本化**：s1-flow.mjs 扩至 **16 项断言**——直接经内核属性端点读 `custom-clip-*`（不经插件服务，"卸载"等价）+ 清空插件 saveData（glean-index.json/settings.json）后属性仍在内核。发布门禁第 3 条满足，TODO 已勾。
- **CHANGELOG「未发布」段已备**（本轮；无反馈时唯一在门禁内的准备项）：S1–S4+阅读线的用户视角条目全部落档，定版后只需回填版本号；ACCEPTANCE §9 该缺项转为就绪。
- **发布门禁终检预演已通过**（本轮）：`pnpm check:release` 14/14 PASS（版本一致/dist 产物齐/zip 与图标尺寸合规）——待作者定版后即可走 RELEASE.md 步骤。
- **UX 审计十项全落地（作者指令轮）**：①设置 AI 组拆「常用 / 通道·进阶」②页签伴生栏优先级评分下移至 AI 段后 ③inbox 术语"新剪藏"→"待分拣"（i18n + 原型 + ACCEPTANCE 同步）④行表/看板移除内联优先级评分控件（卡片视图与伴生栏保留编辑）⑤引导"导入器"按钮降级为能力卡文字链接 ⑥迁移器头部图标换 🧹 + 候选横幅全队列常驻 ⑦"每批写入条数"移入迁移器执行现场 ⑧Dock 搜索折叠为图标（工作台/浮窗常驻）⑨阅读条"检测正文/重新剪藏"收为图标、"返回读库中的这篇"缩为"返回读库" ⑩今日拾遗"今天已开始"回执行（会话视图状态，不写属性）。CHANGELOG 未发布段补"改进"条目。
- **原型 Lab 全页面覆盖（作者指令轮）**：design/prototype.html 扩至 **17 帧**（新增：内嵌阅读页签旗舰帧 / Dock 侧栏 / 首启引导扫描预览 / 导入器；更新：桌面库 rail ✨AI 标签 + 正文待核、今日拾遗理由行、桌面设置阅读组与新用户提示），全部经浏览器实渲染截图逐段目检；UI-STANDARD 更版 v1.6。真机 UI 观感仍随 B-0002。
- 门禁：`pnpm check` 0 错误、`pnpm test` 132/132、`pnpm build` 通过、隔离 E2E **16/16**。

- **首启体验优化 + 默认值审计**（作者指令轮，产品优化）：引导第 2 步移除 AI 开关（enrichMode 保持默认 manual，D-0013），能力卡补"AI 稍后可在设置开启"；有候选时完成键变「去工作台确认候选」（直达浮窗）；未选读库笔记本时空态（库视图两画布+今日拾遗）显示「选择读库笔记本」按钮直达设置；设置页顶部加新用户两步提示。**默认值审计结论：DEFAULT_SETTINGS 不动**（消耗/写外部默认关、本地只读便利默认开、reader.openInTab 实验保持关待验收），映射入 PROGRESS。门禁全绿（告警 42→40）。

**工作协议更新（2026-09-30，作者明确指示）**：作者发来的所有需求/想法/截图反馈**一律先加入 TODO.md 待办，不立即开发**；入账时主动扩展同类问题与可拓展事项（作者要"大量的开发待办"）；可用调研结论也转成待办。**只有作者明确说"开始开发"（或点具体任务号）才动手开发。**

**当前局面（2026-09-30 更新）**：v1.1.0 已发布；开发池新增**精品化强化路线图 T-1740–T-1793 共 31 项**（TODO.md，六组：阅读体验/摘录知识/AI 强化/统计回顾/数据生态/工程质量；远期池五项转正；调研确认 Electron 内 speechSynthesis 走系统 TTS 离线可用，T-1744 TTS 仅剩思源桌面端 spike）。**全部只立项未排期，由作者点单驱动**，无点单不自行开发；真机走查反馈随时插队。推进方式：

1. 作者从路线图点单（建议先做 P1：T-1744 TTS、T-1740 本文大纲、T-1750 全库摘录墙、T-1760 问这篇文章、T-1770 阅读热力图、T-1780 一键备份恢复、T-1790 a11y 清零）→ 按契约先行纪律逐项开发；
2. 作者真机走查反馈问题 → 当日补丁闭环；代码与隔离验证侧没有待办任务了。后续推进完全由**作者真机验收反馈驱动**：

1. 作者按 ACCEPTANCE.md 走查（约 1~1.5 小时），反馈问题 → 按"根因→修复→当日补丁版"闭环；
2. 验收通过后走 S6 发布评审：定版本号（语义化建议 1.1.0，逐次请示）→ CHANGELOG 追加 v1.0.4 后条目 → T-1601 拍材料（RELEASE-MEDIA 清单，新增阅读页签帧）→ RELEASE.md 门禁终检 → tag/Release/集市逐次请示；
3. AI 侧不再自行启动新功能；新想法按 D-0008 预留模式先评估立项。

> 续跑口令（新会话直接粘贴）：
> **阅读 D:\思源插件\小驴拾遗\docs\HANDOFF.md 的"当前有效交接"、TODO.md 精品化路线图（T-1740–T-1803）与 docs/ACCEPTANCE.md，先重跑最后改动后的门禁。工作协议：作者发来的所有内容一律先入 TODO.md 待办（主动扩展同类事项与可用调研），不立即开发；作者明确说"开始开发"或点任务号才动手，按契约先行纪律逐项落地；作者报真机 bug 时仍走"根因→修复→当日补丁版"闭环（bug 修复不属新功能开发）；工程纪律见 AGENTS.md 与 docs/DECISIONS.md，UI 以 docs/UI-STANDARD.md（v1.6）为准，不驱动真机（B-0010）。**

## 历史交接存档

历史交接（2026-09-30 上轮，阅读收尾四件套）：T-1729 AI 标签独立筛选 / T-1723 读完并下一篇（无自动前进，pickNextUnread）/ T-1724 命令面板 7 动作（已读/下一篇/稍后/归档/原文/摘录选区/帮助）/ T-1719 首启只读扫描预览；T-1725/1726 补勾选（D-0030 已交付，"提问不做"）（57ad1dc，E2E 15/15）。
再早（D-0030）：伴生栏摘录=引述块插入所选块之后（隔离内核实证）+ AI 伴读动作+结果卡（78b5722，14/14）；（D-0029）：阅读页签 MVP（77de96a）；（S4 对账）：对账投影+清单归档+理由行（4291bba）；（D-0028）：完成时间契约+正文诊断（253afdc）；（D-0027/D-0016）：S3 主体与产品重整路线。教训沉淀：domain 注释不许出现端点字面量；新写块后查 SQL 必须轮询。D-0016 S0–S4 与阅读体验延伸代码全部关闭，真机验收统一记 B-0002。


历史交接（2026-09-30 上轮，伴生栏摘录与 AI 伴读 D-0030）：摘录=引述块插入所选块之后（insertBlockAfter previousID，隔离内核实证，E2E 14/14）；AI 伴读=总结/翻译/相关旧文动作+结果卡、显式保存才写 summary、额度与富化共享（78b5722）。教训：domain 注释也不许出现端点字面量（architecture 测试拦截）。

历史交接（2026-09-30 上轮，阅读页签 MVP D-0029）：`glean-reader` 页签内嵌真实 Protyle + 伴生栏骨架、settings.reader 组、facade.openReader 接线（E2E 13/13）；顺手修复 SettingsView save() 漏写 integration 的打卡持久化 bug。
再早（S4 对账）：重浮/超龄清单对账后索引纯投影（computeDailyFromIndex）、超龄归档候选清单勾选（archiveStaleCandidates 按显式 ID）、今日拾遗"为什么出现"理由行（surfaceReasons）、改天幂等（4291bba）。
再早（D-0028）：完成时间契约与正文诊断（253afdc，E2E 11/11）；（D-0027）：S3 主体（统一状态动作/时间线筛选/载体策略/阅读上下文）；（D-0016 S0）：产品重整路线建立。
D-0016 S0–S4 主线代码全部关闭，作者 v1.0.4 反馈由 S1–S4 覆盖，真机验收统一记 B-0002。

## 更早历史（原文存档）

作者试用 v1.0.4 后反馈主流程错误多、用途和步骤不清。本轮已完成静态代码/文档复盘，重整方案见 [PRODUCT-REPLAN.md](PRODUCT-REPLAN.md)，执行顺序见 [ROADMAP.md](ROADMAP.md) S0–S6 与 [TODO.md](../TODO.md) T-1700 起。下面原有“下一步”“方案 B 待实施”“待发 v1.0.0”等段落为历史记录，不再是当前指令；实际 v1.0.4 已发布、自定义 AI 通道已实现。

**S1 已完成**：锚点 SQL、查询失败提示、URL-only 收录补全、迁移任务持久化/暂停恢复/失败重试、显式状态写入、自动富化队列和迁移/导入统一属性写入均已修复。**S2 已完成**：候选凭证据入列、跨笔记本标签、内部文档排除、URL 规范化与完整分页查重/对账、全文/链接/本地类型、时间来源、候选逐篇处理、宿主 internal 标记、同 URL 冲突停写与显式保留第二份、误报标记解除均已落地；今日拾遗“开始阅读”与“标记已读”分离。

**S3 当前状态**：T-1708、T-1715、T-1716、T-1721 已完成代码与服务/隔离验证。Dock、工作台和看板共用状态动作与 `domain/library-view.ts` 投影；四种载体由 `domain/carrier.ts` 统一打开策略；原生编辑器上下文从文档属性回读并保留返回读库定位请求。T-1722 仅部分完成：导航与原文动作已统一，全文正文缺失诊断和重新剪藏入口仍属 T-1727。编辑器事件挂载、桌面三画布目视、实际窗口导航、移动端按钮和返回定位均未由作者真机验收，继续记入 B-0002；不要把代码/隔离验证写成平台验收。

本轮隔离脚本已扩展为 9 项断言（四载体、五态/优先级/评分、只读筛选和索引重建）；最终门禁已通过：`pnpm test` 118/118、`pnpm check` 0 错误/38 条既有 Svelte 告警、`pnpm build` 通过、`node scripts/e2e/s1-flow.mjs` 9/9 通过、`git diff --check` 通过。未发布新版本。

本轮修改了主链代码、服务回归测试和隔离 E2E 脚本，没有发布新版本。隔离内核 3.8.6 的 `scripts/e2e/s1-flow.mjs` 已扩展至 9 项断言；最后一次代码变更后的完整重跑待收尾。真实扩展实剪、真机 UI、真实 AI、外部导入与收集箱仍见 BLOCKERS。迁移报告中的手工裁决在确认前只修改执行计划，运行中禁编辑；任务到尾但仍有 manual/错误时保留进度。

（该轮旧续跑口令已作废——T-1722/T-1727/T-1709 已在本轮完成，见"当前有效交接"。）

## 当前状态（2026-09-29 第二十二轮：**v1.0.4 已发布**——工作台独立浮窗 + SQL 容错）

- 仓库：`D:\思源插件\小驴拾遗` = GitHub [ai68298100/siyuan-glean](https://github.com/ai68298100/siyuan-glean)，main 已推送。
- **M3 AI 富化全量落地**（v0.3.0 工作版本，未打 tag）：
  - T-1300 富化管线：`services/enrich-service.ts`——`chatGPT({msg})` 生成一句话摘要+AI标签，
    只写 `custom-clip-summary/ai-tags`（schema 层手填字段保护兜底）；语义查重先查
    `embeddingStat().enabled`，未启用/失败静默；失败写 `ai-log.json`（最近 50 条）不阻断收录。
  - T-1301 相关旧文：高亮视图底部 ✨ 区块（嵌入未启用整块隐藏）。
  - T-1302 预置 AI 动作：拾遗·总结/要点/反方观点（`services/ai-actions.ts`，lsActions 幂等补建，
    用户改过的 prompt 不覆盖）。设置开关 `ai.presetActions` 控制。
  - T-1303 智能体工具：list_unread / archive_stale / weekly_digest（index.ts registerAgentTools）。
  - 面板卡 ✨ 手动富化 + 收录后 autoEnrich（fire-and-forget）。
- **桌面画布补全**（T-1400c）：tab 画布列表模式 = 200px rail（队列/站点/标签，点击即筛）+ drow 五列行表
  （✨/⤓ 悬浮操作+批量勾选）；看板 v1、统计/高亮沿用。
- 质量门禁：check 0 错误、**37/37 测试**（新增 enrich 域 7 项）、构建+发布门禁全绿、spike 7/7（155 i18n 键）。
- 契约修正：`/api/ai/chatGPT` 请求是 `{msg: string}` 单字符串（规划书写的 msgs 数组有误），DATA-CONTRACT 已更。

## 关键契约速记（本轮新增）

- AI：chatGPT `(msg)=>string`；响应要求严格 JSON `{"summary","tags"}`，解析必须鲁棒（domain/enrich.ts
  extractJson 平衡花括号）；判重用标题 bigram 重叠 ≥60%（词元法对中文失效，踩过）。
- editor 动作：lsActions NoBody→数组；saveAction {id:"" 新建}；动作以 name 幂等找回。
- node --test 对 domain 新文件的相对导入要带 `.ts` 扩展名。
- git 推拉代理：`git -c http.proxy=http://127.0.0.1:7897 …`。

## 待作者事项

- B-0001 实剪核对；B-0002 真机 UI 验收；**B-0004（新）AI 真机验收**：配置思源 AI 模型后验证
  富化/查重/相关旧文/三个 AI 动作/智能体工具实际效果（需真实模型，隔离内核测不了）。
- 三轮功能（M1/M2/M3）验收后建议直接发 v1.0.0（或按里程碑 v1.1/v1.2 切分，与作者确认）。

## M4 实现速记（本轮新增）

- 重浮算法（domain/resurface.ts，纯函数）：确定性=stableHash(id+YYYYMMDD) tiebreak；幂等=lastSurfaced==今天
  不再出现；多样性=与近 7 天重浮文章标签重叠降权；**lastSurfaced 只在用户行动（读了/改天/归档）时写**，
  未行动明天自然回池（平静原则，属性可复算，无后台进程）。
- 今日拾遗 = 面板默认首屏（views[0]）；原型帧 design/prototype.html「今日拾遗 · 暗」；UI-STANDARD §5.7。
- 配额/超龄：库视图 inbox/later 顶部横幅（overQuota / stalePool ≥ staleDays 一键归档）。
- node --test：tests/*.test.ts 直接 import domain（带 .ts 扩展名）。

## AI 通道速记（第六轮新增）

- 富化三态 enrichMode(off/manual/auto，默认 manual) + enrichDailyCap 每日上限 + usageToday 用量计数
  （ai-usage.json 按日重置）+ dedupOnEnrich 独立开关；旧 enrichOnCapture 布尔自动归一化。
- **方案 B（拾遗专用 AI 通道）已研究可行但未实施**——getSecret 存 key + 桌面直连 + 浏览器降级，
  等作者拍板（docs/RESEARCH-ai-providers.md）；方案 A（思源原生多 Provider 绑「AI 编辑器」）零开发已加引导。

## 技术债速记（第七轮新增）

- 富化串行队列：enrich-service enqueueEnrich（promise 链），auto/manual 共享，防批量并发；
  面板视图偏好：services/prefs.ts（ui-prefs.json）；AI 日志：loadAiLog + 设置-维护展开行。
- 发布材料：docs/CHANGELOG.md（v1.0.0 候选条目已写好）+ docs/RELEASE-MEDIA.md（拍摄手册）。

## E2E 速记（第十三轮新增）

- scripts/e2e/launch-e2e.mjs：一条命令拉起隔离内核+真实 dist+演示数据的完整联调环境
  （端口 6833，setBazaar 信任+setPetalEnabled，GleanE2E 笔记本 4 篇演示剪藏）。
- 桌面 stage 构建含 require(electron) 外部引用，纯浏览器无法启动思源前端（详见
  docs/RESEARCH-browser-e2e.md）——UI 自动化冒烟需 Electron/真机路径（B-0009）。
- 内核 /ws 是真实路由（前端 Model.ts 构造 ws://host/ws），/ws/app 不存在（误判踩坑）。

## 打卡桥速记（第十二轮新增）

- services/checkin-bridge.ts 消费 window.siyuanCheckin v5：探测(protocol==="siyuan-checkin")→whenReady→
  hasCapability→调用；recordReadingDone externalRef=glean:<docId>:<localDate>（同日重复被宿主去重）；
  失败 console 留痕不抛裸异常。settings.integration.{checkinEnabled,checkinItemId}，**默认关**（写能力纪律）。
- 入口：今日拾遗"✓ 读了"→ fire-and-forget 记录；设置"小驴协同·打卡"组开关+项目下拉（queryItems）。
- 雷切无公开 API，待其文档；glean: externalRef 前缀待向打卡仓库登记（identity-and-merge.md 规则）。

## 下一步（第十四轮后：开发侧全部完成，等待作者输入）

1. 小项池已清空（分页预览/进度提示/渐显动效/媒体目录）。**后续开发需要作者输入驱动**：
   验收问题修复（BLOCKERS 流程）、方案 B 实施、渐进阅读/雷切集成（等方向与文档）、
   或作者提出的新功能想法。
2. 作者验收清单：B-0001 实剪 / B-0002 UI 全景 / B-0004 AI 开关 / B-0005 导入器 /
   B-0006 快照 / B-0007 收集箱（需订阅）/ B-0008 双插件联调。
3. 决策点：方案 B 专用 AI 通道；v1.0.0 发版节奏。
4. 发版执行时：按 RELEASE.md 门禁 + RELEASE-MEDIA.md 拍材料 → README 嵌 GIF → 请示打 tag。

## UI 冒烟结论（第十六轮新增）

- **不要用 computer-use 驱动真机思源做冒烟**：单实例转发 + 误绑作者真实实例的风险
  （详见 BLOCKERS B-0010 与 RESEARCH-browser-e2e.md 附加结论）。作者窗口零操作确认。
- UI 验收交由作者真机执行；launch-e2e.mjs 环境可作者自行启动走查。

## 专用通道速记（第十五轮新增）

- 通道二选一 settings.ai.channel（siyuan 默认 / custom）；custom = baseUrl+model+secretName
  （密钥按名经 getSecret 从思源密钥库读取，内核加密，不落插件文件）。
- 直连客户端 api/ai-direct.ts：joinApiUrl 容忍尾斜杠、60s AbortSignal 超时、防御式解析、
  browser-* 前端 CORS 明确报错；enrich-service callLLM 统一路由（token 治理不变）。
- 设置 AI 组：通道分段 → custom 展开三字段 + 测试连接（ping 出人类可读成败原因）。

## 工作台浮窗 + SQL 容错（2026-09-29，作者问题：没有独立弹出的窗口吗）

- 面板头部新增 ⧉ 按钮：完整工作台弹出为独立浮窗（svelteDialog 1020×680，容器挂 glean-tab-root 宽画布类）。
  至此三形态并存：顶栏=工作台 tab / Dock=侧栏 / ⧉=独立浮窗。
- reconcileIndex 改 Promise.allSettled：单条查询失败保留部分结果 + console 留痕，不再整面板空白。
- 教训：svelteDialog 支持 containerClass（宽画布容器类透传）。

# 关键修复：数据变更事件方向（作者反馈：设置后侧栏无动静，2026-09-29）

- 根因：notifyDataChanged 把 glean:data-changed 派发到 .glean-dock-root（父容器），
  而 DockPanel 监听在子元素 .glean-panel 上——DOM 事件只向上冒泡不向下传播。
- 修复：改在 document 上派发，面板监听 document。
- 同轮新增：标签锚点（任意笔记本 #剪藏 标签老文档纳入候选，listTaggedDocs +
  reconcile/rebuild 纳入；设置描述去掉"新文档"措辞——作者反馈采纳）。

# 关键修复：vite 单文件输出（发版前抓到，2026-09-29）

- 动态 import 在 vite lib 构建里被代码分片（schema-*.cjs / client-*.cjs），而思源装载器
  只加载 index.js → 运行时缺 chunk 崩溃。修复：rollupOptions.output.inlineDynamicImports=true
  （vite.config.ts，注意曾出现重复 output 块覆盖配置的编辑事故，已去重）。
- dist 旧产物需手动清理（emptyOutDir:false），发版前务必 rm -rf dist 再构建。

# 入口分工 + 首启引导（2026-09-29，作者反馈驱动）

- 作者反馈：顶栏与 Dock 都开侧栏，浪费桌面画布 → 入口分工（UI-STANDARD §3）：
  **顶栏图标/命令 = 工作台 tab（rail+表格+看板全宽）**，**Dock 图标 = 窄侧栏速览**（toggleDockSidebar）。
- 作者反馈：首开无引导 → OnboardingDialog 三步向导（欢迎→选锚点笔记本+AI开关→能力卡+完成，
  可跳过；onboardingDone 落 ui-prefs.json；桌面 onLayoutReady 自动弹出一次）。
- prefs.ts 保存改 patch 增量合并（多入口互不覆盖）；enrichOnCapture 旧字段勿再引用。

# v1.0.1 修复记录（2026-09-29，已发布上线 + 作者真机确认）

- 根因：openPanel 用 dispatchEvent(new MouseEvent(..., {bubbles:false})) 合成点击，
  而 dock 图标的点击由 document 级委托监听器处理（boot/globalEvent/click.ts:74）——
  不冒泡=委托收不到=空操作。dock 图标本身的原生点击不受影响（思源自管），顶栏图标必现。
- 修复：openPanel 改走 window.siyuan.layout.rightDock/bottomDock/leftDock.toggleModel(dockId, true)，
  兜底 HTMLElement.click()（会冒泡）。app 源码依据：layout/dock/index.ts:666 toggleModel 签名。
- 教训：思源 UI 的程序化交互优先走 window.siyuan.layout 内部 API，勿合成 DOM 事件。

# v1.0.0 发布记录（2026-09-29）

- GitHub Release: https://github.com/ai68298100/siyuan-glean/releases/tag/v1.0.0
  （package.zip 175KB 已附，sha256 af0f2e8a…）；tag v1.0.0 已推。
- **集市未提交**（仍需作者单独授权）；真机验收七项仍待——发现问题走补丁版（v1.0.1+）。
- 发版流程沉淀：版本定版 → CHANGELOG/RELEASE → 清 dist 重建 → check:release →
  tag+push → GitHub API 建 Release+传附件（curl 走代理；node fetch 走代理会挂，踩坑）。

# 历史速记索引

- 第八轮 导入器 / 第九轮 快照 / 第十轮 制卡 / 第十一轮 收集箱 / 第十二轮 打卡桥（各轮速记见 git 历史）。

## 当前有效交接（2026-10-03 T-3204 无障碍运行时质量完成，待真实环境验收）

- 本轮完成主任务 `T-3204`：公共 `simpleDialog` 复用思源真实 `.b3-dialog__container`，新增 `src/libs/modal-focus.ts` 统一处理首次入焦、Tab 循环、Esc、嵌套弹层和关闭后回焦点；移动筛选抽屉也复用该管理器。
- Dock、今日拾遗、迁移器、候选卡、阅读上下文的图标动作补齐 `aria-label`；导入/迁移标题、控件名称、忙碌态和进度播报补齐；标题样式已保持原有视觉密度。
- 新增无障碍与移动焦点静态契约，当前完整 `pnpm test` **388/388**、`pnpm check` 0 错误/0 告警、`pnpm build` 通过、`git diff --check` 通过；build 仅有既有 `inlineDynamicImports` 弃用提示。
- 重要边界：思源宿主已自带 Dialog 焦点规则，本轮没有另造外层 dialog；宿主/移动端/读屏真实操作仍待 `B-0002`。不提交、不打 tag、不发布、不提交集市。
- 下一主任务按执行板推进 `T-3205` UI 状态截图/视觉回归；随后是 `T-3206` 大库性能基线、`T-3207` 数据主权与错误路径审计、`T-3208` 对外能力承诺审查、`T-3209` 中英文术语终审。

## 当前有效交接（2026-10-05 T-3220 边界补测与报告结构化）

- 本轮继续推进主任务 `T-3220`，未修改生产代码、未接入原文排版入口、未触碰作者真实工作区；事务探针仍使用独立临时工作区、动态回环端口和真实思源 `3.8.6` 内核。
- `scripts/spike/transaction-spike.mjs` 新增深层嵌套子树跨父级移动/恢复和唯一列表项移入目标列表样本。实测深层子树 5 个块保持内部原生父级/邻接并恢复；唯一源列表项移动后源空列表从索引消失，旧列表 `getBlockDOM` 为 `code=0` 空内容，脚本已按内容分类而非只看 code。
- 块删除后读回现在明确记录 `readable/empty/rejected/transport-error`；当前插入块删除后为 `code=-1 block not found`。资源删除/权限没有经实证的端点形状，仍记录为未测试，不臆造接口。
- `transaction-report.json` 升为 `reportVersion: 2`，包含 `kernelVersion`、`pluginVersion`、回环 `host/port`、逐项布尔 `results`、完整 `probes` 和 `limitations`，可导入 `e2e:acceptance report`。本轮隔离探针通过，报告路径为 `C:\Users\sunku\AppData\Local\Temp\siyuan-glean-t3220-1791143874720-21700\transaction-report.json`。
- 报告已导入独立验收账本并以 `passed` 关闭，共 15 项隔离证据；本地 `pnpm test` 为 1107/1107，`pnpm check`、`pnpm build`、`pnpm perf:check` 和 `pnpm check:release` 均通过。本轮已提交当前 `codex/` 分支 `bd3df9a`，未合并主线。仍未关闭：双 Protyle、用户中间编辑、真实网络故障、资源权限/删除、编辑器渲染和真实宿主撤销；跨 session undo 无插件归属隔离，因此不提供插件专属撤销。
## 当前有效交接（2026-10-08：同步分支合入准备完成）

本机 `dev/thispc-1002` 正在合并远端 `origin/codex/main-sync-20261008`。同步内容已按当前契约接入：生命周期归档/恢复、摘录墙与颜色投影、CSV/会话排序/朗读与阅读计时、收藏字段、索引损坏保护和内核请求超时。阅读断点保持 `custom-clip-reading-position` JSON 为唯一新写入事实源，历史 `custom-clip-reading-pos` 不再新写。

当前合并现场尚未提交或推送；已通过 `pnpm check`，新增定向测试已通过，正在继续跑完整测试、构建、发布门禁和 `git diff --check`。不得触碰 `main`、升版本、打 tag、创建 Release 或上传集市。
