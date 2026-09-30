# 进度（PROGRESS）

## 可靠性收尾批（续跑口令驱动，2026-10-01）✅

- [x] **T-1841 收集箱半成功恢复**：契约先行 DATA-CONTRACT §0 补 `inbox-orphans.json`。migrateShorthand 的收录失败（网络）与 URL 冲突均入账本（新建孤儿不再静默丢弃）；`retryInboxOrphans` 补收录成功即移出并尝试补删云端、同 URL 冲突孤儿移出交用户处置；InboxSection 遗留孤儿「重试补收录」入口。E2E 断言（账本→重试→src=inbox 属性写全→账本清空）。
- [x] **T-1978 统一失败处理收尾**：补齐最后一个组件级缺口 `ClipStatusActions.invoke`（原 try/finally 无 catch）——失败给可重试提示并恢复 pending。至此全局（命令/右键/组件）无 unhandled rejection。
- [x] 门禁：check 0 错 0 告警、test **156/156**、build 通过、隔离 E2E **29/29**（+1）。未发布新版本。
- 坑重演记录：新服务函数漏 export 第二次发生（saveInboxOrphans）——**新增账本类函数时 export 与定义同时写**，E2E 即时暴露兜住了。

## P1 功能线第七批（续跑口令驱动，2026-10-01）✅

- [x] **T-1840 导入半成功恢复**（重活缺陷之首）：契约先行 DATA-CONTRACT §0 补 `import-orphans.json` 孤儿账本行。runImport 失败时按"建档成功"守卫记录 + hpath 回查补 docId；`retryImportOrphans` 逐条补收录、成功即移出账本；ImportDialog 挂载显示遗留孤儿「重试补收录」、done 阶段显示半成功结算。E2E 断言（账本→重试→属性写全→账本清空）。
- [x] **T-1795 icon-only 按钮审计**：全局扫查（icon-only 按钮已普遍带 title），补齐最后一个缺口 ReaderTab 快照按钮（拍摄/打开双态 title）；「按钮标签可见性」规则入 UI-STANDARD §4.3。
- [x] 门禁：check 0 错 0 告警、test **156/156**、build 通过、隔离 E2E **28/28**（+1）。未发布新版本。
- 小坑：E2E 变量名 `importer` 与首轮导入声明冲突（同函数内重复声明），改名 `importSvc`；新服务函数漏 export（E2E 即时暴露）。

## P1 功能线第六批（续跑口令驱动，2026-10-01）✅

- [x] **T-1794 面板头部文字化**（作者反馈）：头部三按钮（浮窗/整理/设置）加 `glean-icon-btn--labeled` 变体——宽画布（工作台 tab/独立浮窗）图标+文字，Dock 窄栏保留图标+title 不变。
- [x] **T-1761 AI 标签规范化**：`domain/enrich.findSimilarTagGroups` 纯函数（归一化相等 + 包含关系成组，短方 ≥2 字；宁缺勿滥不猜同义词；2 组单测）+ `ai-tag-service`（`suggestAiTagMerges` 扫描索引含影响篇数 / `applyAiTagMerge` 逐组合并 aiTags 全量替换经 writeClip）+ 设置-维护「整理 AI 标签」区（变体→保留目标展示 diff，逐组确认执行）。
- [x] 门禁：check 0 错 0 告警、test **156/156**（+2）、build 通过、隔离 E2E **27/27**。未发布新版本；UI 观感随 B-0002。

## P1 功能线第五批（续跑口令驱动，2026-10-01）✅

- [x] **T-1744 TTS 朗读（首版）**：`domain/tts` 分句合并纯函数（3 组单测）+ `services/tts`（能力探测降级、按句分块顺序朗读防超长截断、停止、语速循环 1→1.25→1.5→0.75 换速重启）+ 伴生栏入口（选区优先/全文兜底、移动端与无能力环境整行隐藏、页签销毁停播）。"从当前位置继续"待真机反馈再议；**朗读效果（voice/CJK 断句）需作者真机验收（B-0002/B-0004）**。
- [x] **T-1773 收录漏斗**：`captureFunnel` 纯函数（单测）+ 统计页三段条形卡（已收录/已完成/待确认候选），纯投影零写入。
- [x] **T-1753 高亮视图增强**：高亮条显示摘录时间（listQuoteBlocks 查询补 updated 字段）+「原文位置」跳转按钮（openTab doc.id=引述块 id）。
- [x] 门禁：check 0 错 0 告警、test **154/154**（+5）、build 通过、隔离 E2E **27/27**。未发布新版本。
- **踩坑（重要）**：Git Bash 的 sed 处理 UTF-8 中文行会产出乱码（本轮 TODO.md 三行损坏，git checkout 恢复后改用 Edit）——**中文内容的批量替换禁止用 sed，一律 Edit 工具**。

## P1 功能线第四批（续跑口令驱动，2026-10-01）✅

- [x] **T-1750 全库摘录墙**：`domain/quotes` 纯函数（分面聚合/组合筛选/导出构造，3 组单测）+ **QuotesView 新面板视图**（第五视图 tab：关键词搜索 + 站点/用户标签/AI 标签分面点击筛选 + 可移除筛选 chip + 计数 + 单页 500 条截断提示 + 空态/失败态分流）；root 元数据 = 索引映射 + `listQuoteRoots` 补未收录文档标题；点击回链 openTab（doc.id=引述块 id，思源打开所在文档）。
- [x] **T-1752 摘录批量导出**：按当前筛选结果一键导出为 `/摘录导出/时间戳` 汇总笔记（`quoteExportMarkdown` 逐条 siyuan:// 回链+来源行）；不写 custom-clip-*（无候选证据不进扫描）；E2E 落盘断言。
- [x] 门禁：check 0 错 0 告警、test **149/149**（+3）、build 通过、隔离 E2E **27/27**（+1）。未发布新版本；摘录墙交互观感与块内精确定位随 B-0002。
- 修档教训：Edit 插入条目时误复制了相邻 T-1751 行（立即发现 sed 删重）——TODO 勾选后 grep 核对相邻任务号唯一性。

## P1 功能线第三批（续跑口令驱动，2026-10-01）✅

- [x] **T-1740 本文大纲**：`services/outline.ts` heading 查询（`type='h' ORDER BY sort`，无新端点，E2E 实证形状）+ ReaderTab 伴生栏可折叠大纲段（层级缩进归一）+ 点击定位走标准 DOM `scrollIntoView`（SDK 公开字段 IProtyle.element，查 node_modules/siyuan 类型确认，未用内部 API）。滚动真机随 B-0002。
- [x] **T-1772 统计导出 CSV**：`domain/csv` RFC 4180 转义纯函数（2 单测）+ `buildLibraryCsv`（18 列、BOM 兼容 Excel）+ 统计页按钮。
- [x] **T-1750/1752 地基**：`highlights.listLibraryQuotes` 全库引述块分页查询 + E2E 断言。踩坑：引述块 SQL 条件是 `type='b'`（与 listQuoteBlocks 实证一致），臆加 `subtype='bq'` 查不到。
- [x] 门禁：check 0 错 0 告警、test **146/146**（+2）、build 通过、隔离 E2E **26/26**（+3）。未发布新版本。
- 方法沉淀：定位 Protyle 能力先查 `node_modules/siyuan/types/protyle.d.ts`（SDK 类型即契约），公开字段够用就不碰内部 API。

## P1 功能线第二批（续跑口令驱动，2026-10-01）✅

- [x] **T-1780 一键备份/恢复**（契约先行）：DATA-CONTRACT 补 §0.1 备份包语义（包是自查证明非第二事实源、不含密钥、两步恢复）。`domain/backup` 纯函数（包校验/非法键丢弃/预览统计，4 组单测）+ `backup-service`（导出批读→浏览器下载；恢复=预览存在性→确认→`restoreClipAttrs` 覆盖写回（clip-store 新增恢复专用写入口，进索引锁）→设置/偏好覆盖→全量对账）+ 设置-维护导出/导入 UI。E2E 回环断言：导出→改动属性→恢复→属性回到备份点。
- [x] **T-1771 月度回顾报告**（本月部分）：`monthlyReview`（只认 doneTime 在本月）+ `buildMonthlyReviewMarkdown` + `/读库月报/YYYYMM` 幂等定位导出 + 统计页按钮。E2E 断言同月不堆积。
- [x] T-1852（备份方案）随之大部分落地（版本/校验/损坏包拒绝/预览/覆盖裁决/密钥不导出/索引重建）；快照资产打包与跨版本升级随 T-1936/T-1954 演进。
- [x] 门禁：check 0 错 0 告警、test **144/144**（+4）、build 通过、隔离 E2E **23/23**（+2）。未发布新版本；下载与恢复真机走查随 B-0002。
- 教训：Edit 工具替换函数声明时 old_string 携带下一行导致误删签名（两次险情均立即发现恢复）——函数级插入先用 sed -n 确认上下文再动手。

## P1 功能线第一批（续跑口令驱动，2026-10-01）✅

缺陷清剿三轮收官后转功能线，本轮三项（T-1770/T-1760/T-1790）：

- [x] **T-1770 阅读热力图**：`domain/stats.readingHeatmap` 纯函数（按 doneTime 聚合周列网格、当前周截断、单测 2 组）+ StatsView 近 26 周热力图（b3 主色 opacity 五档、逐格 aria-label + 文字摘要，兼顾 T-1976）。
- [x] **T-1760 问这篇文章**：`buildAskPrompt`（上下文=本文全文、无关问题拒答、问句 500 字上限）+ `readerAsk`（T-1883 租约队列、额度共享、失败静默）+ 伴生栏单轮输入行（Enter 提交、AI 来源标记结果卡、切文清空）。不做追问、不做聊天窗（铁律 8）。
- [x] **T-1790 a11y 清零**：**svelte-check 0 告警达成**（39→0）——可点击卡片补键盘等价（Enter/Space 配对 role=button）、看板拖放列 role=group、多选 label 事件移入 input、六枚开关补 role=switch/aria-checked/aria-label（T-1971 开关部分顺带完成）、25 条 state_referenced_locally 经"初始化快照函数化"消除、fileInput 转 $state。
- [x] i18n 新增双名键 7 个（stats.heatmap 系列 + reader.aiAsk 系列）。
- [x] 门禁：check 0 错误 **0 告警**、test **140/140**（+4）、build 通过、隔离 E2E **21/21**。未发布新版本；真实 AI 效果待 B-0004，屏读器/键盘真机随 T-1858/B-0002。

## P1 可靠性批次 II（续跑口令驱动，2026-10-01）✅

继续清剩余 P1 缺陷，本轮六项（T-1956/1957/1968/1984/1988/1989），未做新功能：

- [x] **T-1988 导入路径规范化**：domain 增 `normalizeImportFolder` 纯函数（反斜杠归一、空段/`.`/`..` 丢弃、逐段清理非法字符；单测 10 断言），runImport 接线；预览区显示最终落点。
- [x] **T-1984 导入状态**：换文件重置预览页码/执行现场；预览行 key 改稳定分页索引；无笔记本禁用开始键 + 「打开设置」入口。
- [x] **T-1957 设置串行化**：`updateSettings` 写队列（patch 合并基准=队列内最新设置）；引导/迁移器调用点改为只传变化字段——并发保存不再互相覆盖。
- [x] **T-1956 浮窗单实例**：壳层 `workbenchPopup` 守卫 + 真实 destroyCallback 关闭回执；DockPanel 删除 1.5s 定时器猜测。
- [x] **T-1968 对话框统一销毁**：`openDialogs` 登记表 + 统一入口 `openGleanDialog`（六类弹窗），onunload 逐个 close。
- [x] **T-1989 错误边界**：`guardAction` wrapper 接管命令面板 7 动作 + 右键收录——脱敏留痕 + 可重试提示，无 unhandled rejection。
- [x] i18n 新键 5 个双名同步（action.openSettings / import.targetPath / import.noNotebook / msg.actionFailed 等）。
- [x] 门禁：check 0 错误/39 告警、test **136/136**（+1）、build 通过、隔离 E2E **21/21**。未发布新版本；真机项统一随 B-0002。
- 教训：heredoc 写含 `\\` 的正则会丢转义（本次代码与测试双双踩中，改用 Edit 修复）——含反斜杠的内容一律不用 heredoc。

## P1 可靠性批次（续跑口令驱动，2026-10-01）✅

P0 清完后按待办优先级继续，清掉九项 P1 可靠性/一致性缺陷（T-1839/1884/1955/1958/1961/1975/1981/1985/1990），未做新功能：

- [x] **T-1990 索引校验与坏文件隔离**：`loadIndex` 枚举白名单（status 脏条目丢弃、contentType/timeSource/evidence/missing 过滤），坏 JSON 置 `indexCorrupted` 拒绝一切落盘（原文件保留）直到对账/重建完整扫描后合法覆盖。E2E 全链断言：坏文件→增量写被拦→reconcile 恢复。
- [x] **T-1884 属性批读完整性**：`indexFromScopes` 返回 missingIds，属性批读缺失任何文档时对账/重建放弃保存并抛错，旧索引保留。
- [x] **T-1985 archive_stale 真实结算**：改用 `batchSetStatusDetailed`，返回 `{requested, archived, failedIds}`，失败篇可重试。
- [x] **T-1961 SQL ID 注入边界**：clip-store `DOC_ID_UNSAFE` 拒绝列表（引号/分号/空白/注释符等不进 SQL 不落写入），`writeClip` 入口断言、`fetchDocMeta`/HighlightView 拼接前拦截。
- [x] **T-1839 ReaderTab 竞态**：`loadContext` 加 `contextSeq` 代次守卫；顺带删除重复的"读完并下一篇"按钮（T-1893 清单项）。
- [x] **T-1975/T-1981 HighlightView**：`loadSeq` 代次贯穿引述/相关旧文/标题三段异步；监听 `glean:data-changed` 强制刷新。
- [x] **T-1955 偏好竞态**：prefs 全部读写入串行队列（load→merge→save 原子）；DockPanel 加 `prefsLoaded` 屏障，加载完成前不保存。
- [x] **T-1958 周报幂等定位**（部分）：同周重复生成先查 `/读库周报/{title}` 复用同一文档 ID，不堆积；内容更新语义待 createDocWithMd 覆盖行为实证。
- [x] 门禁：check 0 错误/39 告警、test **135/135**、build 通过、隔离 E2E **21/21**（+2：周报幂等、损坏索引全链）。教训：ID 边界校验选"拒绝注入向量"而非严格格式白名单，测试 harness 短 ID 才能共存；新端点（getFile）未 spike 不引入。真机项统一随 B-0002。

## P0 缺陷批次修复（作者指令"按待办计划开发"，2026-10-01）✅

按待办优先级清掉可靠性/数据主权七项 P0（T-1881/1882/1883/1885/1979/1980/1987），未做新功能：

- [x] **T-1881 索引写入串行化**：`index-store.ts` 新增 `withIndexLock` 内存互斥；`writeClip` 的 load→改→save 段、`reconcileIndex/rebuildIndex` 保存段全部入锁——多画布并发写不同文章不再互相覆盖增量。
- [x] **T-1882 对账合并与代次**：服务层进行中对账合并（挂载风暴共享一次扫描）；`DockPanel.reload` 加请求代次守卫，快速连续刷新丢弃晚到旧结果、销毁后不写状态。
- [x] **T-1883 AI 额度原子租约**：`enrich-service` 导出 `runAiTask`，伴读总结/翻译的"检查额度→调用→计数"全程入同一串行队列，与富化并发不再超额。新增并发回归（额度 2、并发 4 只放行 2）。
- [x] **T-1885 完成统计口径**：`aggregateStats` 与周报 doneItems 改为只认 `doneTime`（与状态解耦）——读完又归档的文章不再丢本周完成记录（对齐 D-0028 本意）；单测更新 + 归档不丢用例。
- [x] **T-1979 首启导入路由**：引导能力卡"导入器"链接改走 `facade.openImport()`（原先误开迁移器）；`finish` 收敛为纯完成。
- [x] **T-1980 焦点编辑器与收录前置**：`focusedEditor()` 按活跃选区/焦点元素解析（分屏不取错文档，无焦点回退旧行为）；状态命令对未收录文档提示不写（i18n 双名 `msg.notInLibrary`）；`batchSetStatusDetailed` 服务端兜底跳过未收录文档。
- [x] **T-1987 内部宿主身份**：schema 增 `isMarkedInternalDoc`；库宿主复用要求 internal 标记（旧版无标记宿主以"内部已有四字段库"幂等补标恢复），闪卡宿主只认标记、无标记另建（旧卡按块注册仍可复习）；av 增 `findDocsByTitle` 全候选查询。同名用户文档永不写入。
- [x] 契约同步：DATA-CONTRACT 补宿主复用身份、状态动作前置、索引写入互斥与对账合并、AI 租约四段语义（行为澄清，无新属性）。
- [x] 门禁：`pnpm check` 0 错误（39 条既有告警不变）、`pnpm test` **135/135**（+3）、`pnpm build` 通过、隔离 E2E **19/19**（+3：状态守卫、双宿主身份）。未发布新版本；真机验收项统一随 B-0002。

## 精品化强化路线图立项（作者命题：打造绝对精品；2026-09-30）✅

- [x] 调研：对标 Matter（付费点=TTS 朗读/摘要/高亮）、GoodLinks（纯净阅读视图/彩色高亮）与仓库 RESEARCH-folo/reading；技术可行性确认——**Electron 内 `speechSynthesis` 走系统 TTS、离线可用**（TTS 朗读可行，仅剩思源桌面端 spike）。
- [x] TODO.md 新增 **T-1740–T-1793 共 31 项**强化任务，六个组：阅读体验（大纲/键盘流/排版/主题/TTS/双语对照/进度与计时·契约先行）、摘录知识（全库摘录墙/AI 问句制卡/批量导出/高亮回跳）、AI 强化（问这篇文章/标签规范化/批量富化/失败重试/每日简报/http 警示）、统计回顾（热力图/回顾报告/CSV/收录漏斗）、数据生态（一键备份恢复/对外桥接/多设备研究/移动重浮）、工程质量（a11y 清零/虚拟滚动/键盘可达/i18n 终审）。
- [x] 远期池五项全部转正立项（T-1750/T-1764/T-1770/T-1782/T-1783）；T-1503 渐进阅读保持延后。只立项不排期，作者点单驱动。

## E2E 整体复测（作者指令，2026-09-30）✅

- [x] `scripts/e2e/s1-flow.mjs` **16/16**（收录→迁移→五态→完成时间→正文测量→摘录引述→拾遗/超龄→下一篇→筛选→重建→数据主权全链）。
- [x] `pnpm spike` **9/9**（属性/性能/语义双态/导出/制卡/快照/双锚点/dist 装载 + i18n 414 键）。
- [x] `launch-e2e` 真实 dist 装载：内核 3.8.6 启动、petal 启用且 loadPetals(frontend=desktop) 含插件（i18n 414 键）、GleanE2E 四篇演示剪藏 custom-clip-* 属性齐全。停机后 6833/6831 无内核孤儿。
- [x] 环境发现（非代码问题）：launch-e2e 持久工作区存在历史遗留空父文档「剪藏」，四篇演示文档是其子文档——**无害保留**（删除会连带演示文档）；外部探针初判"异常"系漏传 loadPetals 的 `frontend:"desktop"` 参数，复测排除。
- 结论：**未发现代码问题**。UI 层（本轮 UX 十项）不在服务级 E2E 覆盖内，真机观感仍随 B-0002。

## 首启体验优化 + 默认值审计（作者指令，2026-09-30）

- [x] **页面清单盘点**（回执作者）：Dock 侧栏 / 工作台 tab（rail+行表/网格/看板）/ ⧉ 独立浮窗 / 内嵌阅读页签（左正文右伴生栏）/ 原生编辑器阅读条 / 设置页（8 分组）/ 迁移器 / 导入器 / 首启引导 / 帮助弹窗 / 命令面板 7+4 动作。
- [x] **首启流程优化**：引导第 2 步移除"收录时自动富化"开关（降低首启决策负担，enrichMode 保持默认 manual，D-0013），补"其余保持默认即可"提示；能力卡步补"AI 可稍后在设置开启"说明；**有候选时完成键变为「去工作台确认候选」**（直达浮窗逐篇确认，T-1719 行动闭环）。
- [x] **空状态 CTA**：未选读库笔记本时，库视图（tab+dock 两画布）与今日拾遗的空态显示「选择读库笔记本」按钮（直达设置），不再只有一句提示。
- [x] **设置页新用户提示**：顶部加"新用户只需两步"说明行。
- [x] **默认值审计（结论：DEFAULT_SETTINGS 不动）**：纪律映射——消耗 token/写外部数据默认关（enrichMode=manual、checkinEnabled=false）；本地/只读便利默认开（dedupOnEnrich、relatedWhileReading、presetActions——均为嵌入查询或幂等补建，不自动耗 token）；重浮 dailyCount=3、staleDays=90、inboxQuota=50 为体验参数；reader.openInTab=false（实验功能，待 B-0002 验收后再议默认）。旧版"引导写 enrichMode"的行为同时移除。
- [x] 门禁：`pnpm check` 0 错误（**40 条**告警，移除引导 AI 开关顺带消 2 条）、`pnpm test` 132/132、`pnpm build` 通过。引导与空态属 UI 层，真机观感随 B-0002。

## 验收驱动转型：作者验收手册 + 数据主权脚本化（2026-09-30）

- [x] **docs/ACCEPTANCE.md 成文**：作者真机验收手册——环境准备（真机装包 / launch-e2e 隔离联调）、B-0001 实剪、B-0002 十三项界面与阅读链路清单（含页签/伴生栏/AI 标签筛选/命令动作/首启预览/移动端）、B-0004 真实 AI 七步（含额度与 off 降级）、B-0005 导入、B-0006 快照、B-0007 收集箱、B-0008 打卡、数据主权抽查；问题反馈格式与"当日修复→补丁版"流程约定。AI 不驱动真机（B-0010 红线）。
- [x] **T-1108 数据主权用例脚本化**：`scripts/e2e/s1-flow.mjs` 扩至 **16 项断言**——不经插件服务直接经内核属性端点读 `custom-clip-*`（状态/优先级/评分/载体/完成时间），并清空插件 saveData（glean-index.json/settings.json）后属性仍在内核。发布门禁第 3 条（含数据主权）就此满足。
- [x] **T-1713 发布门禁预检**（结论入 ACCEPTANCE.md §9）：门禁 1/2/3 已绿；缺项=版本定版（建议 1.1.0，逐次请示）、CHANGELOG 追加 v1.0.4 后条目、T-1601 截图/GIF（新增阅读页签帧）、桌面/移动走查（即本手册 §2）、集市授权。
- [x] 门禁：`pnpm check` 0 错误、`pnpm test` 132/132、`pnpm build` 通过、隔离 E2E **16/16**。未发布新版本。

## 阅读收尾四件套（T-1729/T-1723/T-1724/T-1719；代码/隔离验证完成，真机验收进行中）◐（2026-09-30）

- [x] T-1729 AI 标签独立分面与筛选：`library-view` 新增 `aiTag` 筛选与 `aiTags` 分面（与用户 `tags` 完全分开）；Dock 两侧筛选器与 tab rail 增加 ✨AI 标签组；关键词搜索仍同时匹配 AI 标签但不冒充用户标签分面（域层 4 断言）。
- [x] T-1723 "读完并下一篇"显式动作：`pickNextUnread`（对账索引投影，排除当前篇；池空回退等待最久的未读；不写状态）+ 伴生栏 "✓→ 读完并下一篇"（完成写入成功才切页，队列空提示不回滚）+ 命令面板"打开下一篇"。**无自动前进开关**——默认不自动前进（E2E 实证）。
- [x] T-1724 命令面板阅读动作 7 项：标记已读 / 打开下一篇 / 稍后读 / 归档 / 打开原文 / 摘录选中文本为引述（原生编辑器选区，定位失败降级复制）/ 帮助（`?` 清单；快捷键在思源 设置→快捷键 自定义，默认不占键位）。done 命令同样走打卡桥钩子。
- [x] T-1719 首启引导候选预览：第 3 步改为**只读扫描预览**（已收录 / 待确认候选 / 候选缺来源三计数 + "普通笔记不会入库，逐篇确认才写入"说明；扫描失败可返回或跳过）——只读属性并重建索引缓存，不写文章属性。
- [x] 补勾选 T-1725/T-1726（上轮 D-0030 已交付其闭环，含"提问不做"口径）。
- [x] 门禁：`pnpm check` 0 错误（42 条既有类告警）、`pnpm test` **132/132**、`pnpm build` 通过、隔离内核 E2E **15/15**（新增下一篇选择断言；正文段落查询改轮询规避 SQL 索引时序抖动）。未发布新版本。

## 阅读页签伴生栏：摘录与 AI 伴读（D-0030；代码/隔离验证完成，真机验收进行中）◐（2026-09-30）

- [x] 契约先行：D-0030 决策——**摘录=引述块插入原文档**（插所选块之后，不新增属性、不写用户标签，§4 高亮视图自动聚合；定位失败明示降级为仅复制）；**AI 伴读=动作+结果卡**（临时显示可复制，仅显式"保存为 AI 摘要"写既有 custom-clip-summary；额度与富化共享，不做聊天窗）。DATA-CONTRACT §3.3 与 UI-STANDARD §5.10 同步激活摘录段/AI 段。
- [x] T-1730d：`domain/reader.ts`（clampExcerpt/引述块 DOM/两个 prompt 构造，3 项单测）+ `services/excerpt-service.ts`（选区提取限定正文宿主；`insertQuoteExcerpt`）+ api `insertBlockAfter`（previousID 变体，**隔离内核 E2E 实证**引述块插入与高亮聚合可见）；ReaderTab 摘录段（选区预览/摘录为引述/制卡/复制）。
- [x] T-1730e：`services/reader-ai.ts`（总结全文/翻译选区，显式动作；失败不扣额度，与富化同语义）+ enrich-service 导出 callLLM/aiQuotaAvailable/recordAiUsage/logAiEvent 共享通道与额度 + ReaderTab AI 段（结果卡带「AI · 通道 · 动作」来源标记、复制、保存为 AI 摘要、相关旧文列表点击页签内跳转；AI 关闭显示提示而非按钮）。
- [x] 架构守门立功：domain 注释含端点字符串被 architecture 测试拦截，已改写。
- [x] 门禁：`pnpm check` 0 错误（42 条既有类告警）、`pnpm test` **131/131**、`pnpm build` 通过、隔离内核 E2E **14/14**（新增摘录断言）。真实 AI 模型的总结/翻译/相关旧文效果待 B-0004 真机；选区交互待 B-0002。未发布新版本。

## 内嵌阅读页签 MVP（D-0029 立项；代码/构建完成，运行时行为待真机）◐（2026-09-30）

- [x] T-1730a：作者拍板方案 A 后契约先行——D-0029 决策（正文由思源编辑器承载、实例可在原生或插件页签；不做自绘渲染器）、DATA-CONTRACT §3.3（页签是视图不是存储，无新文档属性）、UI-STANDARD §5.10（左正文右伴生栏布局与交互裁决，伴生栏预留 T-1725 摘录段与 T-1726 AI 段）。
- [x] T-1730b：`settings.reader` 组（`openInTab` 默认关 + `defaultMode` read/edit）+ 设置页"阅读页签（实验）"分组 + i18n 双名 + 归一化单测。
- [x] T-1730c：`glean-reader` 自定义页签 + `ui/ReaderTab.svelte`（SDK `Protyle` 实例：preview/wysiwyg，`switchMode` 切换不重建；`destroy` 生命周期；resize 事件自适应）+ 伴生栏（ClipStatusActions/ClipRankControls/检测正文/重新剪藏/打开原文/快照/返回读库，动作与三画布同服务同语义）+ facade 新增 `openReader/consumeReaderFocus`，`openReadingDocument` 按设置路由页签；`readClipContext` 扩展 site/快照/优先级/评分只读投影。
- [x] **顺手修复潜在 bug**：SettingsView `save()` 此前未把 `integration` 写入 patch，打卡开关的持久化实际失效；现显式写入 integration 与 reader。
- [x] 门禁：`pnpm check` 0 错误（42 条告警=38 既有 + 4 条 ReaderTab 有意初始化取值）、`pnpm test` **128/128**、`pnpm build` 通过、隔离内核 E2E **13/13**。**页签运行时行为（挂载/双实例同步/模式切换/销毁/快捷键）必须作者真机验收（T-1730f/B-0002 扩充）**，不冒称平台验证。未发布新版本。

## S4 重浮与回顾对账（代码/隔离验证完成，真机验收进行中）◐（2026-09-30，D-0028 后续）

- [x] T-1710：重浮与超龄归档改为**对账后索引的纯投影**——`computeDailyFromIndex` / `staleCandidatesFromIndex` 不再直读缓存（面板打开/刷新时 reconcileIndex 的结果作为唯一输入）；周报口径此前已按 D-0028 只认可信完成时间。
- [x] T-1710：超龄归档从"一键全归"改为**候选清单预览**：横幅按钮展开逐篇勾选清单（标题/站点/吃灰天数），确认后 `archiveStaleCandidates` 按显式 ID 逐篇归档并报告真实成功数；清单外篇目不受影响。
- [x] T-1717：`domain/resurface.ts` 新增 `surfaceReasons`（吃灰天数/用户优先级/站点/近期未读主题四类事实理由，平静口吻）；重浮卡新增"为什么出现"行；改天幂等与"开始阅读只进 reading"经 E2E 断言锁定。
- [x] 门禁：`pnpm check` 0 错误（38 条既有 Svelte 告警）、`pnpm test` **127/127**、`pnpm build` 通过、隔离内核 `scripts/e2e/s1-flow.mjs` **13/13**（新增重浮确定性+理由、略过幂等、超龄显式清单三项断言）。未发布新版本。

## S3 收尾：完成时间与正文诊断（代码/隔离验证完成，真机验收进行中）◐（2026-09-30，D-0028）

- [x] T-1709（契约先行）：DATA-CONTRACT 新增 `custom-clip-done-time`（D-0028）：仅由显式"标记读完"写入/覆盖，归档与恢复不抹除；导入只采信导出文件的可靠已读时间（Pocket `time_read`，Omnivore/wallabag 无此字段不伪造）；缺键 = 完成时间未知。
- [x] schema/clip-store/索引：doneTime 全链路（解析、序列化、显式状态动作写入、索引投影与重建）。
- [x] 统计与周报改口径：`doneThisWeek` 与周报"本周读完"只按完成时间计；无完成时间的已读只进状态总数，不再用文档 `updated` 伪造。
- [x] T-1722/T-1727：阅读条新增显式"检测正文"（导出重算 `words/minutes` 写回，不修改正文、不删快照）与"重新剪藏"导航（打开原文，官方剪藏扩展产出新文档，同 URL 冲突按 D-0023 裁决）；`domain/content.ts` 新增 `fulltextBodyState`（ok/missing/unmeasured/na），Dock/工作台/看板三画布对全文无字数条目显示"正文待核"。
- [x] 导入器防御性修复：Pocket CSV 行短于表头时缺字段按空串处理，不再崩溃。
- [x] 门禁：`pnpm check` 0 错误（38 条既有 Svelte 告警）、`pnpm test` 125/125、`pnpm build` 通过、隔离内核 `scripts/e2e/s1-flow.mjs` **11/11**（新增完成时间与正文测量两项断言）、`git diff --check` 通过。未发布新版本。

## S1 主链救火 ✅（2026-09-29，D-0017）

- [x] 修正锚点笔记本 SQL 字符串引用；对账任一查询失败向 Dock 报告并保留上次缓存；URL-only 半成品列为候选，显式收录后补齐状态并进入 `inbox`。
- [x] 迁移器改为“扫描报告→用户确认→持久化任务→逐篇分批→暂停/恢复/失败重试”；无 URL 在预览即标为手工处理，逐条结果实时落盘。
- [x] 用户显式改状态使用状态专用覆盖权限并按真实成功数反馈；自动写入仍保护 URL、优先级、评分等手填字段。
- [x] 自动富化取消队列自等；`off/manual/auto`、每日额度、错误后继续执行均有服务级回归；迁移和导入的 `custom-clip-*` 写入统一经 `clip-store`，导入标签只在建文档时传入。
- [x] 运行 `pnpm check`（0 错误，原有 38 条 Svelte 告警）、`pnpm test`（87/87）、`pnpm build`；`node scripts/e2e/s1-flow.mjs` 在隔离思源 3.8.6 内核通过 6 项，临时工作区自动清理内核。
- 此处的“下一阶段 S2”是 S1 结束时的历史计划；当前 S2 收尾见下节，接下来按 S3 推进。

## S2 可信收录与阅读语义 ✅（2026-09-29，D-0018–D-0023）

- [x] 候选按来源证据入列，精确识别 #剪藏，排除普通笔记与插件宿主；支持跨笔记本标签、URL-only、误报持久化和完整分页对账。
- [x] 收录入口统一 URL/正文类型/字数/时长/时间来源；导入预览和执行全量分页查重；候选卡与迁移器展示证据、缺失项、补链接/本地/排除动作。
- [x] 周报、读库数据库、拾遗卡片创建路径写入 `custom-clip-internal=true`；统一经 clip-store 同步索引。
- [x] 今日拾遗“开始阅读”进入 `reading` 并打开文档；“标记已读”才进入 `done`，打卡桥改挂在完成动作。
- [x] 调研 Folo/RSS 阅读器并写入 `docs/RESEARCH-folo.md`；不照搬云端账号、订阅、社交和自动代读，新增 T-1715–T-1720。
- [x] URL 冲突在统一收录管线中完整分页复查：默认返回已有文档，用户显式选择后才保留第二份；显式收录解除误报标记，迁移/收集箱提供已有文章核对路径。
- [x] Readwise Reader/Inoreader 阅读交互调研写入 `docs/RESEARCH-reading.md`，新增 T-1721–T-1728；README 中英文已按真实能力与验收边界重构，列出四款小驴插件和 QQ 群 871707735。
- [x] 门禁：`pnpm check` 0 错误（38 条既有 Svelte 告警），`pnpm test` 105/105，`pnpm check:types` 通过，`pnpm build` 通过；隔离内核 `scripts/e2e/s1-flow.mjs` 最近一次 6 项通过。

## S3 阅读动作与载体导航（代码/隔离验证完成，真机验收进行中）◐（2026-09-30，D-0024–D-0027）

- [x] T-1708：Dock、工作台和看板共用状态动作；显式开始阅读、标记读完、稍后读、归档和恢复均经 `clip-store`，优先级/评分控件与实际成功数反馈已接入。
- [x] T-1715：`domain/library-view.ts` 提供统一纯筛选、分面和排序；状态、站点、用户标签、来源、时间来源、载体和关键词筛选不写属性，隔离 E2E 覆盖真实索引组合筛选与重建。
- [x] T-1716：`domain/carrier.ts` 统一全文、仅链接、本地和未知载体的徽章与打开目标；全文优先思源正文，仅链接在有效 URL 下打开原文，本地/未知不显示网页动作，四载体已纳入隔离 E2E。
- [x] T-1721：原生编辑器上下文显示标题、载体、来源、状态和动作；属性从文档回读，返回读库保留目标定位请求，会话内可继续最近阅读文档。服务层和隔离属性回读已验证；编辑器事件、跨画布回跳和移动布局待 B-0002。
- [ ] T-1722（部分实现）：正文/原文/本地导航及原文不改状态已落地，仅链接缺来源有提示；全文正文缺失诊断与重新剪藏入口仍由 T-1727 负责，桌面/移动交互待 B-0002。
- [x] 隔离脚本已扩展为 9 项断言，覆盖四载体、五态/优先级/评分、只读筛选和删除索引后的重建；最终门禁已重跑：`pnpm test` 118/118、`pnpm check` 0 错误/38 条既有告警、`pnpm build` 通过、`node scripts/e2e/s1-flow.mjs` 9/9 通过，`git diff --check` 通过。

## 产品复盘与重整计划 ✅（2026-09-29，D-0016，S0）

- 审阅 v1.0.4 源码、契约、调研、旧路线、任务与历史发布；明确主线为可信收录→分拣→阅读/拾遗→回顾。
- 静态确认主链 P0：锚点笔记本 SQL、迁移进度初始化、状态显式写入、自动富化队列及候选误判；详见 `docs/PRODUCT-REPLAN.md`。后续在隔离内核逐项复现与修复。
- 新增 S0–S6 修复和验收路线及 T-1700 起任务；“代码落地、隔离验证、真机验收”分开记账。
- 本轮没有修改插件代码、构建或发布。基线 `pnpm check` 为 0 错误/38 告警，`pnpm test` 为 71/71；完整 E2E T-1108 未完成。

## 🛠 v1.0.3 补丁发布 ✅（2026-09-29，第二十一轮：作者反馈修复闭环第二次）

- 作者反馈①：设置读库笔记本后侧栏无动静 → 根因=事件派发方向（父容器→子面板不可达），
  改 document 级派发/监听
- 作者反馈②：老文档也要算 → 标签锚点落地（#剪藏 标签任意笔记本老文档自动入候选），
  设置描述去掉"新文档"措辞
- v1.0.3 发布（GitHub Release + package.zip）；全门禁绿
- **注意**：覆盖安装后必须重启思源（运行中覆盖，旧代码仍在内存）

## 入口分工 + 首启引导 ✅（2026-09-29，第二十轮，作者反馈驱动）

- [x] 入口分工：顶栏/命令=工作台 tab（全宽桌面画布），Dock=侧栏速览（v1.0.2）
- [x] 首启引导：OnboardingDialog 三步向导（欢迎→锚点笔记本+AI开关→能力卡），自动弹出一次，可跳过
- [x] prefs.ts 保存改 patch 增量合并
- 质量门禁：check 0错、71/71 测试、spike 9/9、门禁全绿（250 i18n 键）

## 🛠 v1.0.1 补丁发布 ✅（2026-09-29，第十九轮：作者反馈修复闭环）

- 作者真机反馈：点击图标无反应 → 根因定位（委托监听器收不到不冒泡合成点击）→ 修复 →
  v1.0.1 发布（GitHub Release + package.zip）→ 待作者覆盖安装确认
- **首次反馈→修复→发版闭环完成**（当日当日修）

## 🎉 v1.0.0 首个公开版本发布 ✅（2026-09-29，第十七轮）

- [x] 发版就绪检查全绿（check 0错/71测试/spike 9/9/av 6/6/门禁 14/14）
- [x] 发版阻断修复：vite 动态 import 分片 → inlineDynamicImports 单文件输出
- [x] 版本 1.0.0 定版；GitHub Release 发布并附 package.zip；tag v1.0.0 已推
- [x] 集市未提交（需作者单独授权）；七项真机验收仍待作者执行（装包验收）

## UI 冒烟尝试与安全收尾 ⚠️（2026-09-29，第十六轮）

- [x] computer-use 真机驱动尝试：发现单实例转发机制 + 误绑作者真实实例风险，
      **立即停止交互**（作者窗口零操作），孤儿进程清理，主实例探测健康（B-0010）
- [x] 结论：UI 冒烟交由作者真机执行；E2E 启动器保留供作者自查
- 质量门禁不变：71/71 测试、spike 9/9、门禁全绿

## 方案 B — 拾遗专用 AI 通道实施 ✅（2026-09-29，第十五轮；T-1300c）

- [x] domain/ai-direct.ts（URL 拼接/载荷/响应解析/前端降级判定，纯函数）
- [x] api/ai-direct.ts（直连 chat/completions：getSecret 读密钥→60s 超时→防御式解析；
      browser-* CORS 明确报错）+ testDirectChannel（设置页测试连接）
- [x] enrich-service callLLM 通道路由（custom 直连 / siyuan 官方，token 治理不变）
- [x] 设置 AI 组改版：通道二选一分段 + 自定义三字段 + 测试连接；238 i18n 键
- [x] 质量门禁：check 0 错、71/71 测试、构建+门禁全绿、spike 9/9
- 联调（作者）：真实免费 API 测试连接与富化（并入 B-0004）

## E2E 启动器 + 纯浏览器限制调查 ✅（2026-09-29，第十三轮）

- [x] scripts/e2e/launch-e2e.mjs：隔离工作区+真实 dist+信任启用+演示数据（4 篇各状态剪藏），
  一条命令拉起完整可联调环境（内核侧全通过：loadPetals 含插件、i18n 227 键）
- [x] 调查：桌面 stage 构建含 electron 外部引用，纯浏览器启动必然中止——环境限制非插件缺陷
  （排除过程：启动 API/资源全 200、/ws 内外均 OPEN、主模块 require(electron) 即崩）
- [x] 结论与替代覆盖落账 docs/RESEARCH-browser-e2e.md + BLOCKERS B-0009；
  Electron 自动化/真机客户端两条路径待作者需要时投入

## 小项池清空 ✅（2026-09-29，第十四轮）

- [x] 导入器大文件分页预览（50 行/页 + 上一页/下一页；T-1501a）
- [x] 批量收录进度提示（收录中 done/total → 完成含富化入队数）
- [x] 重浮卡分卡渐显入场（60ms 递进一次性动效，动效预算内）
- [x] docs/media/ 目录建立（拍摄清单就位，等真机材料）
- [x] 质量门禁：check 0 错、71/71 测试、构建+门禁全绿、spike 9/9（227 i18n 键）

## M5 — T-1505 小驴协同（打卡桥）✅（2026-09-29，第十二轮）

- [x] 研究：打卡 v5 契约完整可消费（探测/whenReady/20 项能力/recordEvent 幂等语义）；
      雷切无公开 API，方向待其文档就绪（B-0008 附注）
- [x] services/checkin-bridge.ts：探测+whenReady+能力协商（items.query/events.range.read/events.record）
      + recordReadingDone（externalRef=glean:<docId>:<localDate>，失败隔离留痕重试语义）
- [x] 设置协同组：开关（默认关）+ 阅读打卡目标下拉（queryItems 拉取）；
      重浮"✓ 读了"钩子 fire-and-forget
- [x] 质量门禁：check 0 错、71/71 测试（checkin 4 项）、构建+门禁全绿、spike 9/9（222 i18n 键）
- 联调（作者）：双插件真机验证（B-0008）

## M5 — T-1500 收集箱 ✅（2026-09-29，第十一轮；联调待作者订阅账号 B-0007）

- [x] 契约核实：getShorthands {page} → **双层包裹**（response.data.data.shorthands，云收件箱特有形状）；
      Shorthand 含 shorthandURL（官方前端丢弃、本插件保留）；open-menu-inbox detail {ids, element}
- [x] api/inbox.ts（防御式剥包 + getShorthand 单条）+ services/inbox-service
      （迁入=建文档+captureClip(src=inbox)+云端时间覆盖；云端删除失败不阻塞）
- [x] UI：库视图顶部"📥 思源收集箱"折叠区（未登录/无订阅整块隐藏）；条目 迁入/忽略(云端删除)
- [x] 编辑器外第二右键：open-menu-inbox 注入"迁入读库（选中 N 条）"
- [x] 质量门禁：check 0 错、67/67 测试、构建+门禁全绿、spike 9/9（216 i18n 键）

## M5 — T-1502 摘录制卡 ✅（2026-09-29，第十轮）

- [x] spike ⑧ 制卡闭环（createDeck→insertBlock→addRiffCards，**9/9**）：
      卡块范式=列表项（父内容=正面，嵌套子列表=背面，官方闪卡标准）——段落嵌套 DOM 被内核拒（踩坑已记）
- [x] api/riff.ts + domain/flashcard.ts（卡面构造/DOM 转义，5 单测）+ services/flashcard-service.ts
      （牌组+宿主文档幂等续建；v1 不耗 token，AI 问句化留动作钩子）
- [x] UI 入口三件：高亮卡 🎴 制卡按钮 / 命令"摘录制卡(选中文本)" / 编辑器右键菜单（显示选中字数）
- [x] 架构守门测试立功：flashcard-service 裸调端点被抓 → 重构走 api 层（insertBlockDom 入 client.ts）
- [x] 质量门禁：check 0 错、67/67 测试、构建+门禁全绿、spike 9/9（209 i18n 键）
- 制卡验收（作者）：真实闪卡复习流程里确认卡片正背面渲染（B-0002 扩充）

## M5 — T-1504 全页快照 ✅（2026-09-29，第九轮）

- [x] 契约核实：`/api/export/exportHTML {id,pdf}` → data{name,content}（单文件 HTML）；
      `/api/file/putFile` 为 **multipart**（path+file，apicontract/file.go）——宿主 fetchPost 原生透传
      FormData（app/src/util/fetch.ts:35），api/assets.ts 落地
- [x] snapshot 属性入契约与索引（custom-clip-snapshot 存 assets 路径）
- [x] services/snapshot-service：exportHTML → putFile 写 /<笔记本>/assets/glean-<id>-<ts>.html →
      写快照属性；面板卡/行表 📷 动作（有快照=⟐ 打开资产，无=拍摄）；openTab asset 打开
- [x] spike 增 ⑦ 快照闭环（exportHTML→putFile→getFile 读回含正文）**8/8 通过**；
      ⑥ 修正为 id+LIKE 精确断言+索引滞后重试（SQLite ial 异步刷新踩坑）
- [x] 质量门禁：check 0 错、62/62 测试、构建+门禁全绿（204 i18n 键，CSS 27.6KB）

## M5 启动 — T-1501 迁移导入器 ✅（2026-09-29，第八轮；按作者"继续开发+推荐项先行"授权启动 M5）

- [x] domain/importers.ts：Pocket HTML/CSV、Omnivore JSON、wallabag JSON 四格式解析
      （防御式解析坏行跳过；URL 去重含尾斜杠归一；状态映射 unread→inbox/read→done/archive→archived）
- [x] services/import-service.ts：preview（解析+库内 URL 去重标记）+ runImport
      （建文档 → captureClip 写 URL/站点/时间/src=import-* → 外部标签写用户 tags 位 → 状态映射）
      时间保留原服务收藏时间（epoch/ISO → 思源本地墙钟）
- [x] ui/ImportDialog.svelte：文件选择 → 预览表（三统计卡+重复标记）→ 进度 → 完成三类汇总；
      目标笔记本/目录可选；设置-维护入口 + facade.openImport
- [x] spike ⑥ 断言修正（id+LIKE 精确断言替代 updated 排序窗口，工作区复用下不再顺序敏感）
- [x] 质量门禁：check 0 错、62/62 测试（importers 11 项）、构建+门禁全绿、spike 7/7（201 i18n 键）
- 导入器验收（作者）：拿真实 Pocket/Omnivore 导出文件跑一遍（B-0005 新增）

## 发布准备 + 技术债 ✅（2026-09-29，第七轮）

- [x] T-1300d 富化队列串行化：批量收录时 auto/manual 富化逐个执行（enqueue promise 链），
      防并发打满模型；手动与自动共享同一队列防重复
- [x] 面板视图偏好持久化（services/prefs.ts ui-prefs.json，只存界面偏好不碰文章数据）
- [x] AI 日志查看入口：设置-维护"AI 日志"展开最近 20 条失败记录（loadAiLog，新的在前）
- [x] 发布材料：docs/CHANGELOG.md 建立（v1.0.0 候选全量条目）+ docs/RELEASE-MEDIA.md
      （头图 GIF 六步脚本 / 集市五张截图 shot list / 关键词自查 / 上架检查单）
- [x] 质量门禁：check 0 错、53/53 测试、构建+门禁全绿、spike 7/7（181 i18n 键）

## AI 消耗控制 + 专用通道研究 ✅（2026-09-29，作者命题）

- [x] 富化三态触发 off/manual/auto（默认 manual，token 需显式开自动）+ 每日上限 + 今日用量显示
- [x] 语义查重独立开关（嵌入通道，不耗 LLM token）；旧 enrichOnCapture 布尔归一化兼容
- [x] 每日上限门卫进 enrichClip（auto/manual 共享额度，超限 skipped:"cap" + 提示）；用量 ai-usage.json 按日重置
- [x] 研究：思源原生多 Provider+场景绑定（方案 A 零开发可用，已加引导）；拾遗专用通道方案 B 可行待拍板
      （docs/RESEARCH-ai-providers.md + D-0013）
- [x] 质量门禁：check 0 错、53/53 测试（settings 兼容 5 项）、构建+门禁全绿、spike 7/7（177 i18n 键）

## M4 — 抗吃灰内核（v0.4.0 工作版本，待真机验收）✅（2026-09-29）

- [x] T-1400 每日重浮：domain/resurface.ts 纯函数——确定性挑选（stableHash(id+日期) tiebreak，
  同池同日跨重启结果一致）、lastSurfaced=当天幂等排除、近 7 天重浮标签重叠多样性降权、
  priority 加权；lastSurfaced 只在用户行动时写（未行动明天自然回池，平静原则）。11 项单测。
- [x] T-1402 今日拾遗视图：面板第四视图且为默认首屏；原型帧一次过审回 port
  （渐变左条大卡+✨拾遗标签+AI摘要+改天/归档/读了三按钮+平静脚注）；空态 🌱"明天再见，不用有负担"
- [x] T-1401 配额与超龄：inbox 超 quota 温和横幅 + 超龄归档候选横幅一键批量归档
  （staleCandidates 纯函数 + archiveStale 服务）
- [x] 索引/域链路补 summary 字段（重浮卡展示 AI 摘要）
- [x] 质量门禁：check 0 错、48/48 测试、构建+门禁全绿、spike 7/7（165 i18n 键，CSS 26.9KB）
- 真机验收项（作者）：重浮挑选实际观感与"读了/改天"手感（B-0002 扩充）

## M3 — AI 富化（v0.3.0 工作版本，待真机验收）✅（2026-09-29）

- [x] T-1300 富化管线：services/enrich-service.ts（chatGPT 摘要+AI标签 → 写 ai-tags/summary，
      永不碰手填字段；语义查重先查 embeddingStat.enabled；失败静默写 ai-log.json 最近 50 条）
      + domain/enrich.ts（prompt 构造/鲁棒 JSON 解析/bigram 判重，7 项单测）
- [x] T-1301 相关旧文：高亮视图底部 ✨ 相关旧文（semanticSearchBlock 文档级，嵌入未启用整块隐藏）
- [x] T-1302 预置 AI 动作：拾遗·总结/要点/反方观点（editor/saveAction 幂等补建，不覆盖用户改过的 prompt）
- [x] T-1303 智能体工具三件：list_unread / archive_stale / weekly_digest（addAgentCapability）
- [x] T-1400c 桌面 rail+行表：tab 画布 列表模式升级为 200px rail（队列/站点/标签，点击即筛）
      + drow 五列行表（状态点/标题/站点/字数时长/徽章+悬浮✨⤓勾选）
- [x] 面板卡 ✨ 手动富化按钮 + 收录后自动富化（fire-and-forget 不阻塞）
- [x] 契约修正：/api/ai/chatGPT 请求为 {msg:string}（规划书 msgs 数组说法有误），DATA-CONTRACT 已更
- [x] 质量门禁：check 0 错、37/37 测试、构建+门禁全绿、spike 7/7（155 i18n 键，CSS 25.1KB）
- 真机验收项（作者，需配置 AI 模型）：富化/查重/相关旧文/AI 动作/智能体工具的实际效果（B-0004）

## UI 标准 — 桌面端定稿 + 规范成文 ✅（2026-09-29，第三轮 UI 迭代）

- [x] 桌面原型四帧（design/prototype.html）：库 tab（216px rail + 五列行表）/ 五列看板 / 全宽统计
      （4 卡 Bento + 周柱图 + 双列分布）/ 双栏设置；浏览器截图迭代三轮
      （修：drow 列宽换行、kcard 徽章换行、big-chart 百分比高度）
- [x] **docs/UI-STANDARD.md v1.1 成文**（贯穿开发周期的 UI 契约）：设计原则/令牌表/三档画布
      （Dock 320 / Tab 全宽 / 对话框）/组件词表（与原型同词表）/场景标准（看板/AI 预留/文案）/实现守门
- [x] AGENTS.md 铁律 6 升级为"一切 UI 以 UI-STANDARD 为准"
- [x] 回 port：tab 宽幅响应式（列表网格化 + Bento 4 列）+ 看板 v1（HTML5 拖卡=batchSetStatus，
      列 hover 橙虚线落点提示，仅桌面画布）+ 150 i18n 键
- 质量门禁：check 0 错、30/30 测试、构建+门禁全绿、spike 7/7（CSS 21.8KB）

## M2 — 数据库视图与统计（v0.2.0，功能落地待真机验收）✅（2026-09-29）

- [x] UI 设计系统定稿：design/prototype.html 三轮浏览器截图迭代（玻璃/胶囊/Bento/弹簧）→
      src/index.scss 全量回 port；面板改版为 库/统计/高亮 三视图（D-0011）
- [x] T-1200 挂库向导：av-spike 6/6 复验（建库/字段/绑行/itemID/写值/渲染）；
      ensureLibraryAnchor 幂等续建 + bindAllClipsToLibrary 分批(≤50)补绑 + 状态列对齐（D-0012）
- [x] T-1201 统计视图：domain/stats.ts 纯函数聚合（7 天收录桶 noon 对齐修正）+ Bento 卡 +
      站点/标签分布 + Markdown 周报导出（读库周报/）
- [x] T-1202 高亮视图：当前文档引述块聚合（SQL root_id+type='b'，sort ASC），只消费不编辑
- [x] 质量门禁：check 0 错误、30/30 测试、构建+发布门禁全绿、spike 7/7 回归（含新 dist 加载 148 i18n 键）
- [x] 设置面板回 port：iOS inset grouped + chips + 滑块开关 + 挂库入口
- [x] 迁移器回 port：步进器 + 统计卡 + 状态胶囊表格
- 真机验收项（作者）：dock/顶栏/三视图/迁移器/设置/挂库 的实机操作（B-0002 扩充）

## M0 — 尖刺验证 ✅（2026-09-29）

- [x] 仓库骨架：git init、真值文档八件套、AGENTS.md、D-0001~D-0010 落账（含源码定调 D-0010）
- [x] 头像 icon.png（小驴系列风格：琥珀渐变卡片 + 白麦穗 + 落粒，gen-icon.mjs 变体 a）+ 过渡 preview.png
- [x] 脚手架：Vite 8 + Svelte 5 + TS + pnpm；构建/发版/图标脚本齐；发布门禁 14/14 PASS
- [x] M0 spike **7/7 通过**（隔离内核 ~/SiYuan-Glean-Spike）：属性闭环/千篇库 LIKE 14~50ms/
      语义双态/exportMdContent/插件加载+i18n 双名/双锚点 SQL。报告：docs/spike-report.md
- spike 三项契约修正进 DATA-CONTRACT §5（batch 映射形状 / semanticSearch types map 无 boxes /
  embeddingStat 字段）；T-1403 关闭（SQL 直查够快，索引降级为缓存）
- 后置给作者：剪藏扩展实剪核对（B-0001）、dock/顶栏真机目视（B-0002）

## M1 — 地基 v0.1.0（功能代码全量落地，待真机验收后发 v1.0.0）✅（2026-09-29）

- [x] T-1100 属性服务层 clip-store（schema 校验 + 幂等 + 手填字段保护 + 批量状态 + 对账/重建）
- [x] T-1100a domain 纯函数（schema/迁移启发式）+ 25 项单测全绿
- [x] T-1100b api 层（attr/sql/notebook/export/semantic 全部 spike 实证形状）
- [x] T-1101 设置视图（锚点笔记本多选 / AI 开关组 / 重浮参数 / 批量大小 / 索引重建）
- [x] T-1102 迁移器（dry-run 报告 → ≤50/批可暂停续跑 → 完成报告三类；进度持久化）
- [x] T-1103 状态机与批量操作（五态白名单 + 多选批量）
- [x] T-1104 Dock 面板（五队列 + 待收录区 + 一键全部收录 + 搜索 + 排序 + 批量条）
- [x] T-1105 收录入口三件套（面板/右键菜单/命令）
- [x] T-1106 命令（打开面板 ⌥⌘G / 加入读库 / 整理剪藏库）
- [x] T-1107 派生索引 glean-index.json（写入同步 + 面板对账 + 重建）
- [x] T-1109 README 中英双版 + 集市关键词补偿
- [x] 架构守门测试（domain 纯净 / 端点只准 api 层 / UI 禁 fetch）
- 验收口径：pnpm check 0 错误、25/25 测试、构建 + 发布门禁全绿、隔离内核加载插件通过；
  **真机 UI 验收与 M1 发版（v1.0.0 打 tag）等作者有空时进行（作者指示后置）**
