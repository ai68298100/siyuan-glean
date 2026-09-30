# 功能、UI、交互与流程复核（2026-09-30）

本轮是对当前工作树的只读复核。目标是检查产品重整 S0–S6 的实际闭环是否还有可发现的风险，并把新增问题登记到 `TODO.md`；没有修改 `src/` 功能代码，也没有驱动作者真实思源窗口。

## 复核范围与证据

- 阅读 `AGENTS.md`、`PRODUCT-REPLAN.md`、`UI-STANDARD.md`、`ACCEPTANCE.md`、`DATA-CONTRACT.md`、`DECISIONS.md` 和现有 `TODO.md`，按“候选→确认收录→分拣→开始读→读完→重浮/回顾→归档/导出”主链重走职责。
- 静态检查 `src/index.ts`、`src/services/{clip-store,index-store,import-service,inbox-service,snapshot-service,stats-service,prefs,enrich-service}.ts`、`src/ui/{DockPanel,ReaderTab,SettingsView,OnboardingDialog,MigrateDialog}.svelte` 与 `reading-context-controller.ts`。
- `pnpm test`：132/132 通过。
- `pnpm check:svelte`：0 错误、39 条警告；主要是可点击 `div` 缺键盘处理、拖放容器缺 ARIA、设置开关缺标签、Svelte 状态初值捕获和 `fileInput` 非响应式。这些已有问题分别挂接 T-1858、T-1886–T-1892、T-1893，不另建同义任务。

## 复核后仍需处理的具体问题

| 区域 | 证据 | 风险 | 新待办 |
|---|---|---|---|
| UI 偏好 | `DockPanel.svelte` 的 `$effect` 同时启动 `loadUiPrefs` 与 `saveUiPrefs({lastView: view})`；多个 Dock/工作台/浮窗实例也会读写同一个文件 | 首次默认 `resurface` 可能覆盖上次视图；不同画布后写入的视图顺序不确定 | T-1955 |
| 弹窗交互 | `openPopup()` 只在 1500ms 后把 `popupOpen` 置回 false，未绑定真实关闭/销毁事件 | 弹窗仍在时重复打开，或弹窗已关闭但按钮短暂失效；用户无法判断当前实例 | T-1956 |
| 设置持久化 | `index.ts:updateSettings` 以当前对象做浅合并，Settings/Migrate/Onboarding 都可异步保存完整对象 | 快速切换开关、批量大小和读库设置时，旧快照可能覆盖刚写入的新字段；多个设置窗互相覆盖 | T-1957 |
| 周报 | `stats-service.ts:exportWeeklyReport` 每次直接 `createDocWithMd('/读库周报/{week}')` | 同一周重复生成多个同名周报，内部文档索引和候选排除依赖后续扫描；失败重试也会产生重复 | T-1958 |
| 阅读上下文归属 | `reading-context-controller.ts` 对 eventBus 的全部 `loaded/switch-protyle` 事件挂载；ReaderTab 自己创建 Protyle，外部批注也可能创建临时 Protyle | 可能在内嵌页签或批注弹层内重复挂载阅读条、切换后残留，影响焦点和销毁 | T-1959（扩展 T-1934） |
| 智能体写动作 | `index.ts:archive_stale` 直接按当前索引批量写 `archived`，没有预览、上限、游标或逐条结果 | 外部调用者无法确认扫描时刻和实际成功项；索引过期时可能归档已变化条目 | T-1960 |
| SQL 输入边界 | `clip-store.ts:fetchDocMeta` 与 `snapshot-service.ts:docBox` 把 doc ID 直接拼接进 SQL；其他查询有转义或 ID 格式检查 | 目前 ID 通常来自内核，但外部导入/批注/事件一旦传入异常字符串会扩大注入和错误查询面 | T-1961 |
| 帮助对话框 | `index.ts:showReaderHelp` 用 `innerHTML` 拼接本地化文本和 inline style | 难以满足统一样式与 CSP；后续翻译或动态文案含标记时有渲染注入风险，焦点/关闭协议也不统一 | T-1962 |
| 导入/收集箱半成功 | `runImport`、`migrateShorthand` 都先建文档再写属性/删云端条目；中止、属性写失败或云端删除失败会留下半成品 | 重试可能再建同名文档；用户分不清“本地已落库、云端未删除、属性未完成”的恢复动作 | T-1963（细化 T-1842/T-1854） |
| 快照资产 | `snapshotClip` 先写 assets，再写 `custom-clip-snapshot`；文档移动/删除也没有资产校验或回收记录 | 写属性失败产生孤儿文件，路径变更后索引指向旧资产；重复拍摄无法判断文件是否存在或是否损坏 | T-1964（衔接 T-1878/T-1936） |
| 来源导航 | Reader/Dock/命令动作调用 `window.open` 后不检查返回值或 popup blocker；重剪藏只是打开原文提示 | 用户看到“已打开”但浏览器可能阻止新窗口；失联/跳转失败没有统一结果状态 | T-1965（衔接 T-1896/T-1937） |
| 自动富化刷新 | 收录成功后 `autoEnrich` fire-and-forget，面板马上 `reload/reconcileIndex`；富化完成再次写索引 | 快速切换文章或多个入口收录时，旧对账结果可能遮蔽刚写入的摘要/AI 标签；失败、排队、完成没有统一 UI 状态 | T-1966（衔接 T-1882/T-1883） |
| 首启导入入口 | `OnboardingDialog` 的“有 Pocket / Omnivore 存量？用导入器搬进来”按钮调用 `finish(true)`，而 `finish(true)` 打开的是 `openMigrate()` | 用户从首启进入“整理剪藏库”迁移器，无法到达 `ImportDialog`，主流程在入口处走错 | T-1979 |
| 当前编辑器解析 | `index.ts:currentDocId()` 取 `getAllEditor().find(...)` 的首个编辑器，不保证是焦点编辑器；命令状态动作也不检查当前文档是否已收录 | 多编辑器并开时可能对错文档；普通笔记可被命令直接写入 status/done-time，绕过“确认收录后进入五态” | T-1980 |
| 高亮切换刷新 | `HighlightView` 只在 `$derived(facade.currentDocId())` 变化时加载，未监听 Protyle 切换或 `glean:data-changed`；异步加载也无代次 | 切换当前文档后仍显示上一篇引述/关联，旧结果可能覆盖新文档 | T-1981 |
| 外部状态保真 | Pocket HTML 解析出 `time_read` 到 `doneTime`，但条目状态固定为 `inbox`；`runImport` 只在 `row.status === done` 时写 `doneTime`；Omnivore 只映射 `isArchived` | 已读时间或已读状态导入后丢失，统计与用户预期不一致 | T-1982 |
| 统计标签来源 | `domain/stats.ts` 的 `byTag` 遍历 `aiTags`，统计页文案却是普通“标签分布” | AI 推断标签被展示成用户标签事实，违反两类标签分面边界 | T-1983 |
| 导入对话框状态 | 重新选择文件不一定重置 `previewPage`；预览行以 URL 作 Svelte key；未选笔记本时“开始导入”只 return，缺少明确提示/设置入口 | 换文件后出现空页或错行；用户点击导入无反应，不知道必须先选笔记本 | T-1984 |
| 发布产物内容 | `check:release` 检查 zip 存在和 manifest/文件门禁，但不比较 zip 内文件与本次 dist 的 hash，也不证明 zip 由本次构建生成 | 旧 package.zip 可能在门禁通过后被提交，安装内容与当前源码/版本不一致 | T-1986 |
| 内部宿主身份 | 闪卡牌组、周报、数据库等通过笔记本/标题或路径找宿主，随后写 `custom-clip-internal` | 用户已有同名文档可能被当成插件宿主并被写入属性；宿主碰撞还会影响候选排除和重复创建 | T-1987 |
| 导入路径 | ImportDialog 的 folder 是自由文本，执行时直接拼入 `/folder/title`；未统一清理前导/尾部斜杠、`.`/`..`、反斜杠和空段 | 预览路径与最终 hpath 不一致，可能跨目录、重复建文档或在重试时落到不同位置 | T-1988 |
| 异步拒绝边界 | ReaderTab 状态动作、`ClipStatusActions.invoke`、设置/导入/迁移/首启初始化存在 `void` 或未捕获 promise | 内核/网络失败时出现 unhandled rejection，按钮可能一直忙或用户没有恢复动作 | T-1989 |
| 派生索引校验 | `index-store.loadIndex` 对 status/contentType/timeSource、数字范围、candidate evidence/missing 主要做浅层类型兜底 | 损坏或用户手工编辑的 saveData 可能生成未知 CSS/i18n 状态、错误排序或批量操作；坏索引没有隔离和可见修复路径 | T-1990 |

## 已复核但不新增编号的事项

- ReaderTab 当前确有两个相同的“读完并下一篇”按钮，且翻译动作仍含硬编码“文A”；挂接 T-1893。
- SettingsView 的多个开关缺 `aria-label`/`role=switch`，Dock/看板/行表多处 `div[role=button]` 没有键盘事件；挂接 T-1858、T-1886–T-1889。
- UI 规范要求固定视觉样式收敛到 `glean-` 类和 CSS 变量，但 Settings/Import 等仍有固定 inline style；挂接 T-1913。
- `reconcileIndex` 全量扫描、AI 额度检查后计数、批量属性缺行保护、完成历史与归档统计等既有风险仍未实现；分别挂接 T-1881–T-1885、T-1911、T-1859。

## 复核结论

当前 domain 单测、i18n、架构守门和已有隔离测试是绿的，但它们不能覆盖多个 UI 实例竞态、真实弹窗销毁、周报重复建文档、内嵌 Protyle 归属、外部导航结果和半成功恢复。T-1955–T-1990 需要在开发前分别补数据契约或 spike（涉及文档生命周期、资产、外部事件和 SQL 的条目），再按“实现→隔离验证→作者真机验收”三态关闭。
