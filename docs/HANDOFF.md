# HANDOFF — 续跑交接（每轮开发结束更新本页）

## 当前有效交接（2026-10-01 第二十八轮：T-1901 高亮颜色标记）

- **T-1901 高亮颜色**（最小版）：**契约裁决=颜色存引述块级 IAL `custom-clip-hl-color`**（yellow/red/blue/green，非文档样式、思源原文外观不变）。DATA-CONTRACT §4 契约行；highlights.ts `getQuoteColor`/`setQuoteColor`（覆写/清除经 setBlockAttrs）+ HighlightView 色点五档循环 + 色条渲染。E2E 断言（写入→读取→清除）。
- **关键发现**：**SQL `blocks.ial` 列对引述块自定义键同步有限**（实测写入后 ial 只含 id/updated 等内置键）——颜色读取必须走 `getBlockAttrs` 属性端点，不走 SQL。已记入教训。
- 门禁：check 0 错 **0 告警**、test **169/169**、build 通过、E2E **31/31**。未发布新版本。提交序列：…→ 1edfd35 → f74b85f → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：功能线大项/契约组（T-1901 后续：删除/全库筛选/搜索随 T-1750/T-1753；T-1903 会话队列重排）；重活缺陷已全清；**强烈建议作者安排 B-0002 真机走查**（积压非常多，走查后可按 v1.1.x 补丁版定版）。

## 当前有效交接（2026-10-01 第二十七轮：T-1742 栏宽收尾 / T-1743 阅读主题）

- **T-1742 栏宽三档（收尾）**：`ReaderTypography.width`（narrow/medium/wide）+ 宿主 `--w-*` class（正文 max-width 42/58em/不限居中）+ 循环按钮。T-1742 至此全部交付。
- **T-1743 阅读主题**：`ReaderTypography.theme`（follow/paper/sepia）+ 宿主 `--theme-*` 纯 CSS（纸感 #faf6ef / 护眼 #f4ecd8 作用于正文区域，**不写用户文档样式**）+ ◐/📄/☕ 循环按钮。随排版偏好持久化。
- 坑：接口加字段时模块内 DEFAULTS 字面量漏同步（TS 即时暴露）——**接口加字段同步检查所有字面量构造点**。
- 门禁：check 0 错 **0 告警**、test **169/169**、build 通过、E2E **31/31**。未发布新版本。提交序列：…→ 5f63506 → 8b2079d → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：功能线大项/契约组（T-1901 高亮颜色契约、T-1903 会话队列重排、T-1905 研究结论落地随 T-1866/T-1867）；重活缺陷已全清；**强烈建议作者安排 B-0002 真机走查**（积压非常多，走查后可按 v1.1.x 补丁版定版）。

## 当前有效交接（2026-10-01 第二十六轮：T-1742 排版偏好 / T-1905 删除回收期研究）

- **T-1742 排版偏好**（字号/行距部分）：prefs `ReaderTypography`（fontSize sm/md/lg + lineHeight compact/normal/relaxed，归一化非法回落）+ ReaderTab 模式段旁 A/≡ 循环按钮 + 宿主根 class `glean-reader--font-*`/`--lh-*` 三档应用（SCSS 作用于 `.glean-reader__main`/`.protyle-content`）。ui-prefs 持久化、纯视图状态。栏宽三档留下轮；真机观感随 B-0002。
- **T-1905 删除回收期研究**：docs/RESEARCH-delete-recycle.md——**推荐方案 B「移入【回收】隔离文档」为默认删除语义 + A「彻底删除+二次确认」为二级动作**；不采用定时自动清理（违反平静原则 D-0008 同源）；数据主权靠思源数据历史兜底。裁决落地随 T-1866/T-1867 契约组。
- 门禁：check 0 错 **0 告警**、test **169/169**、build 通过、E2E **31/31**。未发布新版本。提交序列：…→ 91c3cb3 → f74b85f → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：功能线大项/契约组（T-1901 高亮颜色契约、T-1903 会话队列重排、T-1902 已完成报告的真机核对）；重活缺陷已全清；**强烈建议作者安排 B-0002 真机走查**（积压非常多，走查后可按 v1.1.x 补丁版定版）。

## 当前有效交接（2026-10-01 第二十五轮：T-1902 多文档 AI 报告）

- **T-1902 多文档 AI 报告**：`domain/enrich.buildMultiReportPrompt`（勾选篇标题/状态中文标签/来源/摘要清单、20 篇截断、400 字综述要求，单测）+ `reader-ai.generateMultiReport`（**单次调用额度一次**、租约队列/失败静默写 ai-log）+ 批量条「📝 AI 报告」按钮 → 结果弹窗（文本+复制按钮）。结果会话状态不落属性；上下文基于索引摘要（非全文）如实标注。真实模型报告质量随 B-0004。
- 门禁：check 0 错 **0 告警**、test **169/169**、build 通过、E2E **31/31**。未发布新版本。提交序列：…→ f74b85f → 91c3cb3 → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：功能线大项/契约组（T-1901 高亮颜色契约、T-1903 会话队列重排、T-1905 物理删除回收期研究）；重活缺陷已全清；**强烈建议作者安排 B-0002 真机走查**（积压非常多，走查后可按 v1.1.x 补丁版定版）。

## 当前有效交接（2026-10-01 第二十四轮：T-1764 每日简报 / T-1765 通道警示）

- **T-1764 AI 每日简报**：`domain/enrich.buildDailyDigestPrompt`（今日拾遗前 3 篇标题/来源/摘要、150 字串联速览、无摘要占位"（无摘要）"，单测）+ `reader-ai.dailyDigest`（租约队列/额度共享/失败静默写 ai-log）+ 今日拾遗速览卡（`digestOn` = AI 开且非移动端；手动触发 → 结果卡复制/关闭；会话状态仅复制不落属性）。TTS 语音化衔接 T-1744 真机后评估。简报质量随 B-0004。
- **T-1765 通道警示**：设置 AI 通道 custom 分支，baseUrl 以 `http://` 开头（大小写不敏感）时显示 ⚠ 警示行（API 请求传输未加密、密钥本体存思源密钥库不受影响）。
- 门禁：check 0 错 **0 告警**、test **168/168**、build 通过、E2E **31/31**。未发布新版本。提交序列：…→ 1edfd35 → f74b85f → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：功能线大项/契约组（T-1901 高亮颜色契约、T-1902 多文档 AI 报告、T-1903 会话队列重排）；重活缺陷已全清；**强烈建议作者安排 B-0002 真机走查**（积压非常多，走查后可按 v1.1.x 补丁版定版）。

## 当前有效交接（2026-10-01 第二十三轮：T-1846 保存筛选视图）

- **T-1846 保存筛选视图**（契约先行）：DATA-CONTRACT §3 补 savedFilters 语义（仅筛选条件投影、不复制文章状态、失效条件自然空结果、用户显式动作、跨画布共享）。`prefs.ts` 新增 `SavedFilter` 类型与归一化（仅原语键）；DockPanel 库视图：活性筛选非空时出现「保存」输入框（Enter/💾）+ 保存视图 chips（点击应用回填筛选器、× 删除）；命名覆盖语义。**固定/跨画布即时同步留下轮**；高级查询构建器衔接 T-1895。
- 坑：`activeQueue !== "all"` 与 QueueKey 类型无重叠（TS 判不可达比较）——冗余比较直接删；新类型需显式 import。
- 门禁：check 0 错 **0 告警**、test **167/167**、build 通过、E2E **31/31**。未发布新版本。提交序列：…→ 5f63506 → 1edfd35 → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：功能线大项/契约组（T-1901 高亮颜色契约、T-1747 已完成的计时真机核对、作者组收尾核对）；重活缺陷已全清；**强烈建议作者安排 B-0002 真机走查**（积压非常多，走查后可按 v1.1.x 补丁版定版）。

## 当前有效交接（2026-10-01 第二十二轮：T-1741 键盘流 / T-1815 剪藏模板研究）

- **T-1741 页签键盘流**：`handleHotkey`（document keydown + `isReaderFocused` 限定焦点在 `.glean-reader` 宿主且非输入控件）——j/k 块步进滚动（scrollIntoView 复用锚定块定位，无内部 API）、e 切阅读/编辑、m 标记已读（联动阅读计时结算）、x 摘录选区、? 快捷键帮助弹窗。**与思源全局快捷键冲突随 B-0002 真机核验**。
- **T-1815 剪藏模板研究**：docs/RESEARCH-clipper-template.md——公开检索**无法证实**官方剪藏扩展的自定义模板/选择器/meta 抓取能力（官方仓库两次 404；社区教程指向第三方 SimpRead）；已证实仅产出文档前部 URL 模板链接行（无作者）。核对扩展配置页需作者真机（**并入 B-0001**）。证实前 `custom-clip-author` 写入路径维持 T-1813 手动+AI 推断。
- 坑重演（第三次）：新函数 sed/Edit 后闭合结构破坏（showHotkeyHelp 缺 `}`）——**编辑函数体后立即 pnpm check 验证，勿连续盲改**。
- 门禁：check 0 错 **0 告警**、test **167/167**、build 通过、E2E **31/31**。未发布新版本。提交序列：…→ 34737c8 → 5f63506 → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：功能线轻项已基本清完，剩余为大项/契约组（T-1747 已完成的计时组真机核对、T-1846 保存筛选视图、T-1901 高亮颜色等 P2 研究组）；缺陷重活已全清；**强烈建议作者安排 B-0002 真机走查**（积压非常多，走查后可按 v1.1.x 补丁版定版）。

## 当前有效交接（2026-10-01 第二十一轮：T-1842 批量取消 / T-1751 AI 问句卡）

- **T-1842 批量任务背压**（最后一个重活）：`batchSetStatusDetailed`/`archiveStaleCandidates` 增 `options.signal` 检查点（取消保留部分结算，已写成的 ID 保留在 succeeded）；DockPanel 共享 `batchAbort` 取消态（批量条/批量富化进行中显示取消按钮、超龄归档接入），取消回执「已取消（保留已完成部分）」；导入器 importing 阶段取消按钮（已建文档入孤儿账本可重试）。**明确不取消**：收集箱逐条（单条短）、索引重建（中断无害）。迁移器暂停恢复/富化串行队列/进度单调为既有能力。断网/重启 E2E 随 T-1855。
- **T-1751 AI 问句制卡**：`domain/enrich.buildQuestionCardPrompt/parseQuestionResponse`（回忆问句指令/编号引号清洗、120 字上限，单测）+ `reader-ai.inferQuestionCard`（租约/额度共享）+ 摘录段「❓ AI 问句卡」→ 草稿输入框可改 → 「制卡」确认入卡（`makeQuoteCard` 增 `frontOverride` 覆盖默认模板）。写入由用户触发。
- 坑（两次）：新函数重复定义（svelte-check 即时暴露）、纯函数放错域文件导致 import 错——**新增纯函数先确认落点域文件；同轮多次编辑同文件前 grep 函数名唯一性**。
- 门禁：check 0 错 **0 告警**、test **167/167**、build 通过、E2E **31/31**。未发布新版本。提交序列：…→ 20bf344 → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：功能线 T-1748 键盘流（j/k 滚动等，快捷键冲突真机核验）、T-1815 剪藏模板研究（P3）；重活缺陷**已全部清完**；**强烈建议作者安排 B-0002 真机走查**（积压非常多，走查后可按 v1.1.x 补丁版定版）。

## 当前有效交接（2026-10-01 第二十轮：T-1813 作者回填 / rail 作者组）

- **T-1813 作者回填**：`domain/enrich.buildAuthorPrompt/parseAuthorResponse`（公众号名线索提取；结果清洗——"作者："/"公众号："前缀与引号剥离、"未知"与超长/多行拒绝）+ `services/author-service`（`listMissingAuthors` 缺作者扫描 Top100 / `inferAuthor` 单篇 AI 推断——租约队列额度共享、确认前不写 / `applyAuthor` 用户确认写入经 writeClip）+ 设置-维护「补全来源作者」区（逐条：标题+可编辑草稿输入+✨推断+写入按钮，手动填写亦可，Top20 分批）。真实模型推断质量随 B-0004。
- **rail 作者组**（T-1812 收尾部分）：rail 新增「作者」组（✍ 前缀 Top8 截断，与站点/标签组同款）；完整折叠策略仍随 T-1804。
- 门禁：check 0 错 **0 告警**、test **166/166**、build 通过、E2E **34/34**。未发布新版本。提交序列：…→ 18ccca6 → d4e7d9b → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：作者组已基本收官（剩 T-1815 剪藏模板研究 P3）；功能线 T-1746/T-1747 的真机项随 B-0002；缺陷 **T-1842 批量任务背压统一评估**（最后一个重活）；**强烈建议作者安排 B-0002 真机走查**（积压非常多，走查后可按 v1.1.x 补丁版定版）。

## 当前有效交接（2026-10-01 第十九轮：T-1811/T-1812 作者属性组第一轮）

- **T-1811 来源作者属性**（契约先行）：**新增 `custom-clip-author`（string）**——契约裁决为**用户可改可覆盖类**（不进手填保护列表 USER_GUARDED_KEYS；captureClip 收录不自动写；写入途径仅用户内联编辑与 AI 推断经确认）。链路：DATA-CONTRACT §1 → schema → 索引投影 → 行表/卡片「站点 · 作者」显示（title 完整信息）。
- **T-1812 作者分面（部分）**：`library-view` `filter.author` 精确匹配 + `facets.authors` 分面（单测）+ DockPanel 两处筛选器「作者」select（selectedAuthor 状态/activeFilter/selectQueue/clearFilters 全接线，clearFilters 顺带补了 onlyFavorite 重置）。
- 本轮未做（组内剩余）：T-1813 AI 批量推断回填 + 行内联编辑；rail 作者组与站点→作者钻取（依赖 T-1804 折叠策略）；T-1815 剪藏模板能力研究。
- 门禁：check 0 错 **0 告警**、test **165/165**、build 通过、E2E **34/34**（+1）。未发布新版本。提交序列：…→ 548b022 → c798933 → 18ccca6 → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：**T-1813 作者回填**（AI 批量推断逐条确认 + 行内联编辑）；缺陷 **T-1842 批量任务背压统一评估**（最后一个重活）；**强烈建议作者安排 B-0002 真机走查**（积压非常多，走查后可按 v1.1.x 补丁版定版）。

## 当前有效交接（2026-10-01 第十八轮：T-1747 真实阅读计时）

- **T-1747 真实阅读计时**（契约先行）：**契约裁决=新键 `custom-clip-read-minutes`**（number 累计，与 minutes 字数估算语义分离互不读写）。DATA-CONTRACT §1 契约行（可见状态累计/切文销毁标记已读结算/增量累加不足 1 分钟不写/批量自动动作永不写）。
- 实现：`services/reading-time.ts`（`sessionMinutes` 纯计算 2 单测 + `settleReadingMinutes` 增量累加）；ReaderTab 前台累计（**visibilitychange 暂停/恢复**——hidden 停表不计后台；切文结算由 mount effect 的 docId 依赖处理：旧 cleanup 闭包捕获旧 docId 结算旧文档【语义正确，svelte-ignore state_referenced_locally 抑制】；销毁/标记已读 done 前结算）；伴生栏 meta 显示「本次阅读 N 分钟」（30s 刷新，纯会话状态）。
- E2E 累计语义断言：3 分钟→写 3；再 2 分钟→累计 5；30 秒→不写。**计时准确性（休眠/前后台切换）随 B-0002 真机**。
- 门禁：check 0 错 **0 告警**、test **164/164**、build 通过、E2E **33/33**（+1）。未发布新版本。提交序列：…→ 548b022 → c798933 → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：契约先行组 **T-1811 作者属性组**（6 项含 AI 批量回填，大组建议分两轮：先契约+属性+分面，再回填）；缺陷 **T-1842 批量任务背压统一评估**（最后一个重活）；T-1746/T-1747 的真机项随 B-0002；**强烈建议作者安排 B-0002 真机走查**（积压非常多，走查后可按 v1.1.x 补丁版定版）。

## 当前有效交接（2026-10-01 第十七轮：T-1746 阅读断点与进度）

- **T-1746 阅读断点与进度**（契约先行，同时关闭 T-1728 前置）：
  - 契约：DATA-CONTRACT §1 新增 `custom-clip-reading-pos`（块锚定）+ §3.1a 五要素（防抖 30s+切文/销毁写、原生编辑器不写、last-writer、归档不清除、丢失即从头无重建）。
  - 实现：`services/reading-position.ts`（`anchorBlockInViewport` 视口顶部 1/3 锚定、`countDocBlocks/blockPosition` 块序结构估计、`saveReadingPos`）+ ReaderTab 滚动捕获监听（`addEventListener("scroll", fn, true)`）防抖 30s 写、effect cleanup 立即 flush、续读 `scrollIntoView`（600ms 延迟等首屏渲染）、伴生栏顶部细进度条（结构估计**无百分比数字**）。
  - **断点不进派生索引**（单文档阅读状态，E2E 断言索引无该字段）——写入频率 30s/次可接受全量 saveData。
  - E2E 断言：写入→readClipContext 投影→索引无污染。**滚动定位与进度准确性随 B-0002 真机**。
- 坑：effect 内 `host` 变量与外层重名（svelte-check 即时暴露，改名 `scrollHost`）。
- 门禁：check 0 错 **0 告警**、test **162/162**、build 通过、E2E **32/32**（+1）。未发布新版本。提交序列：…→ 33a2570 → 548b022 → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：契约先行组 **T-1747 阅读计时**（契约讨论：新键 or 复用 minutes）、**T-1811 作者属性组**（6 项，含 AI 批量回填）；缺陷 **T-1842 批量任务背压统一评估**（最后一个重活）；**强烈建议作者安排 B-0002 真机走查**（积压非常多，走查后可按 v1.1.x 补丁版定版）。

## 当前有效交接（2026-10-01 第十六轮：T-1745 双语对照 / T-1803 分享卡）

- **T-1745 双语对照**：`reader-ai.readerTranslateFull`（全文 stripMarkdown 8000 字截断、租约队列/额度共享/失败静默写 ai-log）+ 伴生栏「文A+ 全文翻译」按钮 + `translateFull` 结果折叠块（`{@const}` 局部变量绕 Svelte 5 嵌套块 null 收窄——直接引用 `aiResult.text` 会报 possibly null）。真机翻译质量随 B-0004。
- **T-1803 高亮分享卡（文本部分）**：`domain/quotes.formatQuoteShare`（`> 引述` + `—— 标题（站点）` + siyuan:// 回链，单测）+ 高亮视图与摘录墙「⧉ 复制引用」按钮。图片卡片导出仍为待研究。
- **小坑**：i18n 插入新键的 Edit 把锚点行（reader.aiAsk）替换掉了（丢键），i18n 键集合测试即时暴露后补回——**i18n 插入 old_string 要含锚点行并保留**。
- 门禁：check 0 错 **0 告警**、test **162/162**、build 通过、E2E **31/31**。未发布新版本。提交序列：…→ 34737c8 → 33a2570 → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：功能线剩余多为契约先行或大项（T-1746 阅读进度契约、T-1747 阅读计时契约、T-1808 已完成后的 T-1811 作者属性组）；缺陷仅剩 **T-1842 批量任务背压统一评估**（最后一个重活）；**强烈建议作者安排 B-0002 真机走查**（积压非常多，走查后可按 v1.1.x 补丁版定版）。

## 当前有效交接（2026-10-01 第十五轮：T-1808 行表溢出菜单 / T-1763 富化重试标记）

- **T-1808 行表溢出菜单**：行表操作区低频辅助（★收藏/📷快照/✨富化/↗来源）收进 SDK `Menu` ⋯ 溢出（`new Menu(id)` + `addItem({label, click})` + `open({clientX, clientY})`，动态 import "siyuan"，类型已核对 node_modules/siyuan）；高频流转 ClipStatusActions 与多选 ☑ 保留。看板卡暂保持现状（宽裕），观感随 B-0002 再议。
- **T-1763 富化失败重试标记**：语义变更——**富化成功也写 ai-log（stage=ok）**（原 appendLog 只记失败）；`loadEnrichFailedIds` 按每文档最近一条日志判定（非 ok 即失败待重试）。卡片 ✨ 变 ⚠（title=「上次富化失败，点击重试」）+ 溢出菜单条目 ⚠ 前缀；点击即重跑 enrichClip。相关单测期望已同步（日志数组含 ok）。
- 门禁：check 0 错 **0 告警**、test **161/161**、build 通过、E2E **31/31**。未发布新版本。提交序列：…→ 0876482 → 34737c8 → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：功能线 T-1745 双语对照（AI 延伸）、高亮分享卡、T-1755 高亮视图增强已完成剩时间回填核对；缺陷 T-1842 批量任务背压统一评估（最后一个重活）；**强烈建议作者安排 B-0002 真机走查**（积压非常多，走查后可按 v1.1.x 补丁版定版）。

## 当前有效交接（2026-10-01 第十四轮：T-1797 钉住今日 / T-1762 批量富化）

- **T-1797 钉住今日**（契约先行）：**新增 `custom-clip-pinned`（YYYYMMDD 生效日）**——与收藏（favorite 长期标记）、priority（重要性）三方语义分离，互不联动。链路：DATA-CONTRACT §1 → schema → 索引投影 → `domain/resurface.pickDaily`（pinned===今天 置顶优先入选：占每日名额、不参与多样性降权、**覆盖"改天"lastSurfaced 过滤**；隔日 pinned 不匹配自然回池——平静原则不变，无后台清理）→ `actOnSurface("pin")`（写 pinned=今日，不写 lastSurfaced）→ 今日拾遗卡 📌 按钮（toast 回执）。1 组单测 + E2E（置顶首位/属性索引一致）。
- **T-1762 批量富化**：批量条「✨ 批量富化」——多选逐篇 `enrichClip`（串行队列 T-1883 租约、额度统一把守），进度 toast（${done}/${total}）+ 完成真实结算（成功/额度满跳过/失败）。
- 坑重演（第二次）：E2E 变量名冲突 + sed 按行号误改早期代码导入名——已全部恢复；**E2E 追加断言前先 grep 变量名唯一性；变量改名录用唯一名 + Edit 而非行号 sed**。
- 门禁：check 0 错 **0 告警**、test **161/161**、build 通过、E2E **31/31**（+1）。未发布新版本。提交序列：…→ cde5066 → 0876482 → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：功能线 T-1808 行操作溢出菜单、T-1745 双语对照（AI 延伸）、T-1763 富化失败重试入口、T-1755 高亮分享卡（编号已核对为 T-1803 附近组）；缺陷 T-1842 批量任务背压统一评估；**强烈建议作者安排 B-0002 真机走查**（积压非常多，走查后可按 v1.1.x 补丁版定版）。

## 当前有效交接（2026-10-01 第十三轮：T-1967 内核请求超时 / T-1963 失败原因）

- **T-1967 内核请求超时**：`kernelPost(route, body, {timeoutMs})` 默认 **60s 兜底**（本地内核 60s 无响应视为挂起），`KERNEL_TIMEOUT_LONG_MS=180s` 放宽长操作——已放宽点：`batchGetBlockAttrs`/`querySql`（大库分页）/`exportMdContent`/`exportHTML`/`putFile`（快照上传，assets.ts 自带同款超时）。settled 守卫：超时 reject 后迟到响应丢弃。3 组单测（stub fetchPost）。**边界说明：fetchPost 回调模式无底层取消，本轮是"放弃等待"语义；Abort 与断网/重启 E2E 随 T-1855**。默认值若真机误伤（长操作漏放宽），放宽点加 `{timeoutMs: KERNEL_TIMEOUT_LONG_MS}` 即可。
- **T-1963 导入逐条失败原因**：`ImportSummary.failures`（title + 脱敏 reason 前 120 字），done 阶段逐条列出；与孤儿账本（T-1840）互补。完整五态逐条状态机随 T-1842。
- 门禁：check 0 错 **0 告警**、test **160/160**、build 通过、E2E **30/30**。未发布新版本。提交序列：…→ ea7c5ab → cde5066 → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：功能线 T-1808 行操作溢出菜单、T-1745 双语对照（AI 延伸）、T-1797 今日钉住、T-1762 批量富化；缺陷 T-1842 批量任务背压统一评估；**强烈建议作者安排 B-0002 真机走查**（积压非常多，走查后可按 v1.1.x 补丁版定版）。

## 当前有效交接（2026-10-01 第十二轮：T-1904 收藏）

- **T-1904 收藏（契约先行）**：**新增独立属性 `custom-clip-favorite`（boolean）**——设计裁决不复用 priority（收藏与重要性排序语义分离，不联动 priority/rating）。全链落地：DATA-CONTRACT §1 属性行 → schema（ATTR.favorite/parseFlag/serializePatch "true"/null）→ 索引投影（ClipIndexEntry.favorite，loadIndex 防御归一）→ `library-view.favoriteOnly` 筛选（候选不参与；单测）→ UI：行表操作区与卡片右上角星标（★/☆ toggle，writeClip 直写）、ReaderTab 伴生栏标题旁星标（context.favorite 投影经 ReadingClipContext 扩展）、DockPanel 搜索框旁「仅看收藏」switch（role=switch/aria-checked）。E2E 断言（写入→投影→筛选）。**注意：上一轮口令写"T-1755 收藏"是编号笔误，实际任务号=T-1904**（T-1755 编号未占用）。
- 门禁：check 0 错 **0 告警**、test **157/157**、build 通过、E2E **30/30**（+1）。未发布新版本。提交序列：…→ 0c0c319 → ea7c5ab → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：**T-1967 内核请求超时取消**（重活缺陷最后一个大项，波及面大需单独评估默认超时值与长操作豁免清单）、T-1963 逐条失败原因展示、T-1808 行操作溢出菜单、T-1745 双语对照（AI 延伸）、T-1797 今日钉住（与收藏分离的另一半）；**强烈建议作者安排 B-0002 真机走查**（积压功能非常多，走查后可按 v1.1.x 补丁版定版）。

## 当前有效交接（2026-10-01 第十一轮：T-1841 收集箱半成功 / T-1978 收尾）

- **T-1841 收集箱半成功恢复**：契约先行 DATA-CONTRACT §0 补 `inbox-orphans.json`。`inbox-service`：`loadInboxOrphans/saveInboxOrphans/retryInboxOrphans`；migrateShorthand 的收录失败与 URL 冲突均入账本（新建孤儿不再静默丢弃）；重试补收录成功即移出 + 尝试补删云端（失败不阻塞）、同 URL 冲突孤儿移出交用户处置（不无限重试）。InboxSection 展开时账本非空显示「重试补收录」。E2E 断言通过。
- **T-1978 统一失败处理收尾**：`ClipStatusActions.invoke` 补 catch（原 try/finally 无 catch）——失败给可重试提示并恢复 pending。至此全局无 unhandled rejection。
- 坑重演：新服务函数漏 export 第二次（saveInboxOrphans，E2E 即时暴露）——账本类函数 export 与定义同时写。
- 门禁：check 0 错 **0 告警**、test **156/156**、build 通过、E2E **29/29**（+1）。未发布新版本。提交序列：…→ 9f28407 → 0c0c319 → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：重活缺陷仅剩 **T-1967 内核请求超时取消**（波及面大需单独评估默认超时值）、T-1963 逐条失败原因展示；功能线 T-1755/T-1904 收藏（契约先行）、T-1808 行操作溢出菜单、T-1745 双语对照（AI 延伸）；**强烈建议作者安排 B-0002 真机走查**（积压功能已非常多，走查后可按 v1.1.x 补丁版定版）。

## 当前有效交接（2026-10-01 第十轮：T-1840 导入半成功恢复 / T-1795 icon-only 审计）

- **T-1840 导入半成功恢复**（重活缺陷之首）：契约先行 DATA-CONTRACT §0 补 `import-orphans.json` 账本行。
  - `import-service`：`loadImportOrphans/saveImportOrphans/retryImportOrphans`；runImport 的 catch 里按 **existingUrls 守卫**（建档成功才记孤儿）+ 结束时 `attachOrphanDocIds`（按 notebook+hpath 回查无状态文档补 docId，回查不到不误绑）。
  - ImportDialog：挂载时账本非空 → 「重试补收录」入口；done 阶段显示半成功结算（N 篇已记录可重试）。
  - E2E：手工注入账本 → retry → 断言 status/url 写全、账本清空。
- **T-1795 icon-only 审计**：icon-only 按钮已普遍带 title（a11y 轮成果），本轮补最后缺口（ReaderTab 快照按钮拍摄/打开双态 title）；「按钮标签可见性」规则入 **UI-STANDARD §4.3**（icon-only 必带 title；悬浮操作不展开文字；头部宽画布 labeled）。
- 门禁：check 0 错 **0 告警**、test **156/156**、build 通过、E2E **28/28**（+1）。未发布新版本。提交序列：…→ f982b21 → 9f28407 → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：重活缺陷 **T-1841 收集箱半成功**（三步事务，比导入复杂）、T-1963 逐条失败原因展示、T-1967 内核请求超时取消、T-1978 统一失败处理收尾；功能线 T-1755/T-1904 收藏（契约先行）、T-1808 行操作溢出菜单；**继续提醒作者 B-0002 真机走查（积压更多）**。

## 当前有效交接（2026-10-01 第九轮：P1 功能线第六批 T-1794 头部文字化 / T-1761 AI 标签规范化）

- **T-1794 头部文字化**（作者反馈）：DockPanel 头部三按钮加 `glean-icon-btn--labeled` 变体，按 `isTabCanvas` 切换——宽画布（工作台 tab/独立浮窗）图标+文字，Dock 窄栏保持图标+title。UI-STANDARD 响应式条目待下版整理补记。
- **T-1761 AI 标签规范化**：`domain/enrich.findSimilarTagGroups`（归一化相等 + 包含关系成组，短方 ≥2 字防误判；不猜无包含关系的同义词——宁缺勿滥）+ `services/ai-tag-service.ts`（`suggestAiTagMerges` 扫描索引 aiTags 全集返回建议组+影响篇数；`applyAiTagMerge` 组内变体→keep 全量替换，逐篇 writeClip，单篇失败不阻断）+ 设置-维护「整理 AI 标签」（扫描→变体→保留目标 diff→逐组确认合并，完成后 notifyDataChanged）。
- 门禁：check 0 错 **0 告警**、test **156/156**、build 通过、E2E **27/27**。未发布新版本。提交序列：…→ cffe2ce → f982b21 → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：T-1755 收藏/T-1904 长期收藏（契约先行）、T-1795 全局 icon-only 审计、T-1753 已完成后的高亮时间回填核对；重活缺陷 T-1840/1841/1963 半成功账本、T-1967 超时取消、T-1978 统一失败处理；**继续提醒作者 B-0002 真机走查**（新功能积压更多了）。

## 当前有效交接（2026-10-01 第八轮：P1 功能线第五批 T-1744 TTS / T-1773 漏斗 / T-1753 高亮增强）

- **T-1744 TTS 朗读（首版）**：`domain/tts.ts`（`chunkTextForSpeech` 按中英句边界切分合并到 220 上限、超长句硬切；`nextSpeechRate` 档位循环）+ `services/tts.ts`（`ttsAvailable` 能力探测——无 speechSynthesis 的环境全部静默空操作；`speakText` 分块顺序朗读、`lang="zh-CN"`、`stopSpeaking`）+ ReaderTab 伴生栏入口（▶ 选区优先/全文兜底 = `protyle.protyle.element.textContent`；⏹ 停止；语速按钮换速重启朗读；移动端 `facade.isMobile` 与无能力环境整行隐藏；组件销毁停播）。纯会话行为零写入。**真机效果（voice 选择、CJK 断句、语速感受）待 B-0002/B-0004**；"从当前位置继续"待真机反馈再议。
- **T-1773 收录漏斗**：`domain/stats.captureFunnel(captured, done, candidates)` 纯投影（done 按 doneTime 口径 D-0028）+ 统计页三段条形卡。
- **T-1753 高亮增强**：`listQuoteBlocks` 查询补 `updated` 字段（同端点新字段，非新端点）；高亮条显示 MM/DD HH:mm +「原文位置」跳转（openTab doc.id=引述块 id）。
- **踩坑（重要）**：Git Bash 的 sed 处理 UTF-8 中文行产出乱码（TODO.md 三行损坏后 git checkout 恢复）——**中文内容的批量替换禁止用 sed，一律 Edit 工具**；本口令"含反斜杠不用 heredoc"教训之外再加这条。
- 门禁：check 0 错 **0 告警**、test **154/154**、build 通过、E2E **27/27**。未发布新版本。提交序列：…→ 75b4070 → cffe2ce → 本轮（git log）。集市 PR #2288 待审。
- **P1 功能线主线已基本收官**（热力图/问文章/大纲/备份/月报/CSV/摘录墙/批量导出/TTS/漏斗/高亮增强）。下一批候选：T-1761 AI 标签规范化、T-1755 收藏（T-1904 口径）、T-1794 面板头部文字化；重活缺陷 T-1840/1841/1963 半成功账本、T-1967 超时取消、T-1978 统一失败处理；**强烈建议作者安排 B-0002 真机走查**（新功能已大量积压：页签大纲/TTS/摘录墙/备份/热力图/漏斗等）。

## 当前有效交接（2026-10-01 第七轮：P1 功能线第四批 T-1750 摘录墙 / T-1752 批量导出）

- **T-1750 全库摘录墙**：面板第五视图 `quotes`（DockPanel views + PanelView 扩展）。数据链：`listLibraryQuotes`（单页 500+1 探测截断）→ `listQuoteRoots`（分批 IN 补未收录文档标题）→ 索引映射（标题/站点/tags/aiTags）→ `domain/quotes` 纯函数投影（`quoteFacets`/`filterQuotes`，筛选不写属性）。UI：关键词搜索 + 分面点击筛选 + 可移除 chip + 计数 + 空态/失败态分流；点击回链 `openTab({doc:{id: 引述块id}})`。
- **T-1752 批量导出**：`exportQuotesToDoc`（excerpt-service）按当前筛选落盘 `/摘录导出/YYYYMMDD-HHmmss`；不写 custom-clip-*（无候选证据）；E2E 落盘断言通过。
- 修档教训：TODO 勾选插入条目时误复制相邻行（T-1751 重复），sed 删重——勾选后 grep 核对任务号唯一。
- 门禁：check 0 错 **0 告警**、test **149/149**、build 通过、E2E **27/27**。未发布新版本。提交序列：…→ b51a60f → 75b4070 → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：**T-1744 TTS 朗读**（Web Speech API——代码可先写能力探测+降级，效果需作者真机）、T-1773 收录漏斗（纯投影轻项）、T-1753 高亮视图增强、T-1761 AI 标签规范化；重活缺陷 T-1840/1841/1963 半成功账本、T-1967 超时取消、T-1978 统一失败处理。P1 功能线主线（热力图/问文章/大纲/备份/月报/CSV/摘录墙/导出）已全部落地，建议下轮可考虑收尾性小项或作者真机走查（B-0002 清单已积累大量新功能项）。

## 当前有效交接（2026-10-01 第六轮：P1 功能线第三批 T-1740 大纲 / T-1772 CSV / 摘录墙地基）

- **T-1740 本文大纲**：`services/outline.ts`（heading SQL `SELECT id, content, subtype FROM blocks WHERE root_id=? AND type='h' ORDER BY sort`——querySql 既有端点的新查询，E2E 实证）+ ReaderTab 伴生栏可折叠大纲段（`outlineIndent` 相对最小层级归一缩进）+ 点击定位 = `protyle.protyle.element.querySelector('[data-node-id]')?.scrollIntoView()`（**SDK 公开字段**，查 `node_modules/siyuan/types/protyle.d.ts` 确认——定位 Protyle 能力先查 SDK 类型，公开字段够用就不碰内部 API）。滚动行为真机随 B-0002。
- **T-1772 CSV 导出**：`domain/csv.ts`（RFC 4180 转义，2 单测）+ `buildLibraryCsv`（18 列 + BOM）+ 统计页下载按钮。
- **T-1750/1752 地基**：`highlights.listLibraryQuotes(limit, offset)` 全库引述块分页（**条件=`type='b'`**，臆加 `subtype='bq'` 查不到——引述块 subtype 不是 bq，已踩坑记入）。剩视图层：新面板视图 + root 元数据映射 + 筛选分面。
- 门禁：check 0 错 **0 告警**、test **146/146**、build 通过、E2E **26/26**。未发布新版本。提交序列：…→ 50c0103 → b51a60f → 本轮（git log）。集市 PR #2288 待审。
- 下一批候选：**T-1750 全库摘录墙视图**（地基已就绪）、**T-1752 摘录批量导出 Markdown**（共用查询）、**T-1744 TTS**（先 spike 桌面端 voice，Node 无法验证需真机）、T-1773 收录漏斗；重活缺陷 T-1840/1841/1963、T-1967、T-1978。

## 当前有效交接（2026-10-01 第五轮：P1 功能线第二批 T-1780 备份恢复 / T-1771 月度回顾）

- **T-1780 一键备份/恢复**（契约先行 DATA-CONTRACT §0.1）：
  - 包格式 `{version:1, app:"siyuan-glean", exportedAt, settings, index, uiPrefs, clips:[{id, attrs}]}`，attrs 只含 custom-clip-*；**不含密钥**（只导出 secretName 名字）。
  - `domain/backup.ts`：`parseBackup`（版本/应用不符整体拒绝、非法键丢弃）、`pickClipAttrs`、`previewBackup`；`backup-service.ts`：`buildBackupPackage`（listClipDocs+batchReadClipAttrs）→ `backupPackageJson` 下载；`previewRestore`（SQL 存在性检查）→ `restoreBackup`（**经 clip-store 新增的 `restoreClipAttrs`**：IAL 形态补丁直接 setBlockAttrs + 索引锁内增量更新——注意 writeClip 的 patch 是 schema 字段形态，不能直接喂 IAL 键）→ saveSettings/saveUiPrefs → rebuildIndex。
  - UI 在设置-维护：导出（Blob 下载）/ 选包预览（N 篇/可恢复/缺失）→ 确认执行；恢复后壳层经 `facade.updateSettings(pkg.settings)` 同步缓存。
  - E2E 回环：导出→改 rating/status→恢复→属性与索引都回到备份点。
- **T-1771 月度回顾**（本月部分）：`monthlyReview`（doneTime 前缀匹配当月）+ `/读库月报/YYYYMM` 幂等定位导出 + 统计页按钮；年度回顾待走查后扩展。
- **踩坑记录**：Edit 工具做函数级插入时 old_string 不要携带相邻函数的声明行（本轮两次误删函数签名/注释，均靠 sed -n 复查与类型门禁立即发现恢复）。
- 门禁：check 0 错 **0 告警**、test **144/144**、build 通过、E2E **23/23**。未发布新版本。提交序列：0d70bfc → a32d4ec → f77e2f2 → 50c0103 → 本轮（git log）。集市 PR #2288 待审。
- 下一批功能线候选：**T-1750 全库摘录墙**（新视图 + 全库引述块查询）、**T-1740 本文大纲**（先 spike heading SQL 与 Protyle 定位 API——查 node_modules/siyuan 类型）、**T-1744 TTS**（桌面端 voice spike）、T-1772 统计 CSV、T-1752 摘录批量导出 Markdown；重活缺陷 T-1840/1841/1963 半成功账本、T-1967 超时取消、T-1978 统一失败处理。

## 当前有效交接（2026-10-01 第四轮：P1 功能线第一批 T-1770/T-1760/T-1790）

- 缺陷清剿三轮收官后按续跑口令转 **P1 功能线**，本轮交付三项功能/质量项。
- **T-1770 阅读热力图**：`domain/stats.readingHeatmap(doneTimes, weeks, now)` 纯函数——输入 doneTime 数组，输出周列网格（列=周、行=周一..周日、当前周截断到今天）+ maxCount/activeDays/totalDone；StatsView 渲染近 26 周网格（`.glean-heat` CSS grid auto-flow column，b3 主色 opacity 五档 `--l0..l4`），逐格 `role="img"` + aria-label 与文字摘要双通道（兼顾 T-1976 图表文本替代）。年度跨度只需调 HEATMAP_WEEKS。
- **T-1760 问这篇文章**：`domain/reader.buildAskPrompt`（上下文=本文全文 8000 字截断、无关问题要求拒答、`clampAskQuestion` 500 字上限）+ `reader-ai.readerAsk`（runAiTask 租约、额度共享、失败静默写 ai-log）+ ReaderTab 伴生栏 AI 段新增单轮输入行（Enter 提交、aiResult.kind="ask" 结果卡带 AI 来源标记、切文清空）。**不做追问/会话/聊天窗**（铁律 8/D-0030）；选区上下文版本与 T-1726 翻译重叠暂不做。
- **T-1790 a11y 清零**：svelte-check **39→0 告警**。修法沉淀：①可点击 div（role=button/tabindex）统一补 `onkeydown` Enter/Space（DockPanel 用 `activateOnKey(handler)` 辅助）；②看板拖放列补 `role="group"` + aria-label；③多选 `<label onclick>` 事件移入内部 input（label 保持无事件）；④六枚 `.glean-sw` 补 `role="switch"`/`aria-checked`/`aria-label`（T-1971 开关部分顺带完成）；⑤**25 条 `state_referenced_locally`（表单 `$state(facade.settings.x)` 初始化快照）经"快照函数化"消除**——把 props 读取包进 `function snapshotFormState()` 再在顶层调用，静态分析不再报且语义更显式；⑥bind:this 目标转 `$state`。
- 门禁：check 0 错误 **0 告警**（历史最佳）、test **140/140**、build 通过、E2E **21/21**。未发布新版本。
- 提交序列：0d70bfc（P0）→ a32d4ec（P1-I）→ f77e2f2（P1-II）→ 本轮（见 git log）。集市 PR #2288 待审。
- 下一批功能线候选：T-1750 全库摘录墙（新视图+全库引述块查询，体量较大）、T-1780 一键备份恢复（契约先行改 DATA-CONTRACT）、T-1740 本文大纲（先 spike heading SQL/Protyle outline）、T-1744 TTS（桌面端 voice spike）、T-1771 月度回顾报告（复用周报管线，轻）。

## 当前有效交接（2026-10-01 第三轮：P1 可靠性批次 II T-1956/1957/1968/1984/1988/1989）

- 按续跑口令继续，本轮清掉六项 P1 缺陷，未做新功能。剩余 P1 缺陷已不多且多为重活（半成功账本组 T-1840/1841/1963、T-1967 超时取消、T-1978 统一失败处理、T-1975 的 partial 展示），**建议下一轮转 P1 功能线**。
- **T-1988**：`domain/importers.normalizeImportFolder`（反斜杠归一、空段/`.`/`..` 丢弃、逐段清理非法字符，fallback"导入"）；runImport 接线；预览区显示最终落点（i18n `import.targetPath`）。
- **T-1984**：换文件重置 previewPage/summary；预览行 key 改稳定分页索引；无笔记本禁用开始键 +「打开设置」。
- **T-1957**：`updateSettings` 写队列，patch 合并基准=**队列任务内的最新 this.settings**（不是调用时快照）；Onboarding/Migrate 调用点改只传变化字段——这是关键配套：全量快照展开在调用时求值会重新引入覆盖。
- **T-1956/T-1968**：壳层 `openDialogs` 登记表 + `openGleanDialog` 统一入口（六类弹窗，含 help 的 simpleDialog），onunload 逐个 close；浮窗 `workbenchPopup` 单实例守卫（真实 destroyCallback 回执），DockPanel 1.5s 定时器已删。
- **T-1989**：`guardAction` wrapper 接管命令面板 7 动作 + 右键收录（脱敏留痕 + `msg.actionFailed` 可重试提示）。
- i18n 新增双名键 5 个；门禁：check 0 错/39 告警、test **136/136**、build 通过、E2E **21/21**。未发布新版本。
- **教训（重要）**：heredoc 写含 `\\` 的正则会丢转义（本轮代码与测试双双踩中）——含反斜杠内容一律用 Edit 工具，不用 bash heredoc。
- 提交：0d70bfc（P0）→ a32d4ec（P1-I）→ 本轮（见 git log）。集市 PR #2288 仍待官方审核。

## 当前有效交接（2026-10-01 第二轮：P1 可靠性批次 T-1839/1884/1955/1958/1961/1975/1981/1985/1990）

- P0 批次清完后按续跑口令继续，本轮清掉九项 P1 可靠性/一致性缺陷，未做新功能。
- **T-1990 索引校验与坏文件隔离**：`loadIndex` 枚举白名单（status 脏条目丢弃、evidence/missing 白名单过滤）；坏 JSON 置 `indexCorrupted` → `saveIndex` 拒绝一切落盘（**原文件保留**），`confirmIndexRebuilt()` 只在对账/重建完整扫描成功后解除。教训：没有 getFile 封装（新端点须先 spike），"保留原文件"靠拒绝覆盖实现而非副本。
- **T-1884**：`indexFromScopes` 返回 `missingIds`；属性批读缺任何文档 → 对账/重建抛错保留旧索引（"扫描后即刻删除"的保守误报可接受）。
- **T-1985**：`archive_stale` 返回 `{requested, archived, failedIds}` 真实结算（配合 T-1980 服务端守卫）。
- **T-1961**：`DOC_ID_UNSAFE = /['"\\;()\s/]|--/` 拒绝列表——**教训：严格格式白名单（`\d{14}-[0-9a-z]{7}`）会打死测试 harness 的短假 ID，注入向量拒绝列表是任务原文"格式校验或 sqlQuote"的合规解**。writeClip 入口断言 + fetchDocMeta/HighlightView 拼接前拦截。
- **T-1839**：ReaderTab `loadContext` 加 `contextSeq` 代次；**顺带删除了重复的"读完并下一篇"按钮**（T-1893 清单项，该大项仍未完——硬编码"文A"等还在）。
- **T-1975/T-1981**：HighlightView `loadSeq` 代次贯穿三段异步 + `glean:data-changed` 强制刷新。
- **T-1955**：prefs.ts 全部读写入串行队列；DockPanel `prefsLoaded` 屏障（加载完成前不保存——否则默认视图覆盖磁盘偏好）。
- **T-1958（部分）**：周报同周幂等定位（先查 `/读库周报/{title}` 复用 ID，E2E 断言不堆积）；**内容更新**待 createDocWithMd 对已存在路径行为实证（先 spike）再补。
- 门禁：check 0 错/39 告警、test **135/135**、build 通过、隔离 E2E **21/21**（+2：周报幂等、损坏索引全链）。未发布新版本。
- 提交：0d70bfc（P0 批次）+ 本轮 P1 批次提交（见 git log）。集市 PR #2288 仍待官方审核。

## 当前有效交接（2026-10-01 第一轮：P0 缺陷批次 T-1881/1882/1883/1885/1979/1980/1987）

- 作者指令"读取仓库情况，并按待办计划开发"= 开发授权；按优先级先清 **七项 P0 缺陷**（可靠性/数据主权），未做新功能。
- **T-1881 索引写入串行化**：`index-store.ts` 新增 `withIndexLock`（内存 promise 链互斥）；`writeClip` 读改写段与 `reconcileIndex/rebuildIndex` 保存段全部入锁。教训：互斥只约束本插件实例执行顺序，锁内不得再获取锁（当前无嵌套）。
- **T-1882 对账合并+代次**：`reconcileIndex` 进行中调用合并（`reconcileInFlight`）；`DockPanel.reload` 加 `reloadSeq` 代次守卫。全量对账与增量写互斥后，慢对账不再回滚期间的属性写入。
- **T-1883 AI 额度原子租约**：`enrich-service` 导出 `runAiTask`（即原富化串行队列），`reader-ai` 总结/翻译的检查→调用→计数全程入队；并发回归：额度 2、并发 4 任务只放行 2 次模型调用。
- **T-1885 完成统计口径**：`domain/stats.ts` `aggregateStats` 与 `stats-service` 周报 doneItems 改为只认 `doneTime`、与 status 解耦——读完又归档不丢本周完成记录（对齐 D-0028 本意；旧测试断言的正是缺陷行为，已更新）。
- **T-1979 首启导入路由**：`OnboardingDialog` 能力卡"导入器"链接改 `finishThenImport()` → `facade.openImport()`（原先借道 `finish(true)` 开迁移器）。
- **T-1980 焦点编辑器+收录前置**：`index.ts` 新增 `focusedEditor()`（活跃选区/焦点元素定位，无焦点回退第一个编辑器）；`markCurrentStatus` 对未收录文档提示（新 i18n 键 `msg.notInLibrary` 双名）；`batchSetStatusDetailed` 服务端跳过未收录文档（按未成功结算）——超龄清单/看板/智能体的 ID 都来自索引，正常路径不受影响（E2E 实证）。
- **T-1987 内部宿主身份**：schema 新增纯函数 `isMarkedInternalDoc`；`library-db.findVerifiedHost` 只复用带 `custom-clip-internal` 标记的宿主，旧版无标记宿主以"内部已有四字段库（状态/字数/时长/来源）"幂等补标恢复；flashcard 宿主只认标记、无标记另建（riff 无按文档查卡端点，未臆造，旧卡按块注册仍可复习——后续要迁移先 spike `getTreeRiffCards`）；`api/av.ts` 新增 `findDocsByTitle`（全候选，保留旧 `findDocByTitle`）。
- **契约同步**（行为澄清，无新属性）：DATA-CONTRACT §2 补宿主复用身份与状态动作前置；§3 补写入互斥与对账合并；§3.3 补 AI 租约原子性。
- 门禁：`pnpm check` 0 错误 / 39 条既有告警、`pnpm test` **135/132+3**、`pnpm build` 通过、隔离 E2E **19/16+3**（新增：状态动作跳过未收录、读库/闪卡宿主身份三断言；E2E 里新建宿主后查 SQL 必须 `until` 轮询等索引刷新，踩过一次）。未发布新版本。
- 未动项：T-1884/T-1886（P1）保持待办；多画布并发、分屏焦点、宿主幂等的真机行为统一随 B-0002。
- 下一批候选（作者点单驱动）：P1 功能线（T-1740 本文大纲 / T-1744 TTS spike / T-1750 摘录墙 / T-1760 问这篇文章 / T-1770 热力图 / T-1780 备份恢复 / T-1790 a11y 清零），或继续 P1 缺陷（T-1839 ReaderTab 竞态 / T-1840/1841 半成功恢复 / T-1955–T-1957 竞态组 / T-1985 archive_stale 真实结算）。

## 历史交接存档

## 当前有效交接（2026-09-30 UI 专项质感与美观复核）

- 本轮只读 UI 复核记录见 [RESEARCH-ui-polish-audit-2026-09.md](RESEARCH-ui-polish-audit-2026-09.md)，覆盖 `src/index.scss`、`src/ui/*.svelte`、`UI-STANDARD.md` 和 `design/prototype.html`；没有修改 `src/`，没有驱动作者真实思源窗口。
- 新增 UI 专项待办 T-1991–T-2030：令牌与表面层级、排版/间距/图标、操作主次、队列与卡片、三画布容器策略、看板窄宽、阅读伴生栏、对话框/设置、空态/加载/失败反馈、主题/动效/高对比、触控、统计图、视觉性能、CSS 兼容、原型同步、截图回归和发布材料。
- 静态定位的代表性问题：行表操作区在普通状态长期占位；`StatsView` 的 spark 热柱使用 `class:hot` 而样式声明期待 `glean-tile__spark--hot`；ReaderTab 模式按钮缺少 `.glean-seg` 容器；阅读伴生栏固定 264px；Dock/今日拾遗标题截断过早；设置/导入器/统计仍有固定视觉 inline style；首启步骤条和实现不一致；`prefers-reduced-motion`、forced-colors 和集中式 focus-visible 规则尚未形成单一视觉门禁。以上均只入账，未开始开发。
- 上一轮基线仍有效：`pnpm test` 132/132 通过；`pnpm check:svelte` 0 错误、39 条既有告警。UI 专项任务应先按 T-1991/T-2002 建立令牌与容器规则，再按 T-2017–T-2019 建立原型/截图/真机验收链。
- 继续遵守作者工作协议：后续需求先入 `TODO.md` 并主动扩展同类事项；只有作者明确说“开始开发”或点具体任务号，才启动代码开发。发布/集市/版本动作仍逐次请示。

## 当前有效交接（2026-09-30 功能/UI/交互/流程复核）

- 本轮只读复核记录见 [RESEARCH-functional-ui-flow-audit-2026-09.md](RESEARCH-functional-ui-flow-audit-2026-09.md)，没有修改 `src/` 功能代码。
- `pnpm test` 132/132 通过；`pnpm check:svelte` 0 错误、39 条既有警告，已按 T-1858/T-1886–T-1913 挂接。新待办为 T-1955–T-1990，重点是 UI 偏好/设置竞态、浮窗与 Protyle 生命周期、周报/导入幂等、内核超时与异步错误边界、首启导入误路由、焦点编辑器状态流、外部导入已读时间、内部宿主碰撞和索引损坏恢复。
- 已确认的首要流程缺陷：首启“Pocket/Omnivore 导入器”按钮实际打开迁移器（T-1979）；多编辑器命令可能取错文档，普通文档状态命令缺收录前置校验（T-1980）；Pocket `time_read`/Omnivore 状态存在导入保真缺口（T-1982）。这些仍只入账，未开始开发。
- 继续遵守作者工作协议：后续需求先入 `TODO.md` 并主动扩展同类事项；只有作者明确说“开始开发”或点具体任务号，才启动代码开发。发布/集市/版本动作仍逐次请示。

## 当前有效交接（2026-09-30 **v1.1.0 已发布**——产品重整 S1–S4 与阅读体验全链）

**作者已授权发版，v1.1.0 已上线**：https://github.com/ai68298100/siyuan-glean/releases/tag/v1.1.0 （package.zip 213KB 已附，公开可下载；tag v1.1.0 已推）。

- 定版过程：package.json/plugin.json → 1.1.0；CHANGELOG「未发布」段回填 v1.1.0（2026-09-30）；RELEASE.md 历史表已补。
- 门禁：清 dist 重建 → check:release **14/14** → check 0 错 / test 132/132 / 隔离 E2E **16/16** 全绿后才打 tag。
- 发布方式：GitHub API（凭据取自系统凭据管理器 `git credential fill`，curl 走代理；匿名 API 有限流，带认证验证）。
- **集市未提交**（需作者单独授权，流程见 RELEASE.md：fork bazaar → plugins.txt → PR）。
- 发布后仍开放的事项：作者按 ACCEPTANCE.md 真机走查（发现问题走 v1.1.1+ 补丁）；T-1601 截图/GIF（集市材料，若要提交集市才需要）。
- 注意：E2E 持久工作区 ~/SiYuan-Glean-E2E 有历史遗留空父文档「剪藏」（四篇演示文档的父），无害保留勿删。

## 当前有效交接（2026-09-30 `siyuan-comment` 联动调研）

- 已完成只读审计，调研文档为 [RESEARCH-siyuan-comment-integration-2026-09.md](RESEARCH-siyuan-comment-integration-2026-09.md)；未修改功能代码。
- `siyuan-comment` v2.9.4 没有稳定跨插件公开 API。当前可用的研究结论是：未来只能通过内核只读查询读取 `custom-siyuan-comment`、`custom-comment-source`、来源块 `custom-comment-refs` 和批注块 Markdown；不能调用私有函数、私有 DOM/事件或写 `custom-comment-*`。
- 批注可落在原文档、今日日记、指定文档和子文档，T-1917–T-1934 已登记版本/契约/spike、跨 root adapter、ReaderTab 路由、缺席降级、刷新、生命周期、性能、安全、上游 bridge 和现有宿主排除任务；本轮不启动开发。
- 关键风险：`reading-context-controller.ts` 对 Protyle 事件广泛挂载，需优先验证外部批注弹层排除（T-1934）；内嵌 ReaderTab 是否能被外部插件识别必须真机 spike，失败回退原生页签。

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

> 续跑口令（新会话直接粘贴，2026-10-01 第二十八轮更新）：
> **阅读 D:\思源插件\小驴拾遗\docs\HANDOFF.md 的"当前有效交接"、TODO.md 待办总账与 docs/ACCEPTANCE.md，先重跑最后改动后的门禁。进度基线：v1.1.0 已发布、集市 PR #2288 待审；已完成三轮缺陷清剿（22 项）+ P1 功能线十五批（含作者组两轮）+ 可靠性收尾批 + 网络可靠性批 + 批量任务背压/AI 问句卡 + 页签键盘流/剪藏模板研究 + 保存筛选视图 + 每日简报/通道警示 + 多文档 AI 报告 + 排版偏好/删除回收期研究 + 栏宽三档/阅读主题 + **高亮颜色标记（T-1901，引述块级 IAL）**，基线 check 0 错 0 告警 / test 169 / 隔离 E2E s1-flow 31/31。下一批候选：功能线大项/契约组（T-1903 会话队列重排、T-1905 研究结论落地随 T-1866/T-1867、T-1901 后续的删除/全库筛选/搜索）；重活缺陷已全清；**强烈建议提醒作者安排 B-0002 真机走查**（积压功能非常多，走查后可按 v1.1.x 补丁版定版）。工作协议：作者发来的所有内容一律先入 TODO.md 待办（主动扩展同类事项与可用调研），不立即开发；作者明确说"开始开发"、"继续"或点任务号才动手，按契约先行纪律逐项落地（新端点先 spike、新属性先改 DATA-CONTRACT）；作者报真机 bug 时仍走"根因→修复→当日补丁版"闭环。工程纪律见 AGENTS.md 与 docs/DECISIONS.md，UI 以 docs/UI-STANDARD.md（v1.6，§4.3 已含按钮标签可见性）为准，不驱动真机（B-0010），发布/集市/版本动作逐次请示；含反斜杠内容不用 bash heredoc（丢转义）；**中文内容的 sed 批量替换会产出乱码（已踩坑），一律 Edit 工具**；UI 初始化快照用函数化读取；Edit 函数级插入/条目勾选后核对相邻行唯一性；写 IAL 形态属性补丁走 clip-store.restoreClipAttrs；查 Protyle/SDK 能力先看 node_modules/siyuan/types/*.d.ts 类型定义，公开字段够用就不碰内部 API（Menu 溢出菜单亦然：new Menu(id)/addItem/open({x,y})）；SQL 查询条件与既有实证对齐（引述块=type='b'）；E2E 新增变量注意重名；**新增服务函数（账本类）export 与定义同时写（两次漏 export 被 E2E 暴露）**；**引用任务号前先 grep TODO.md 核对（T-1755 收藏系编号笔误，实际为 T-1904）**；**kernelPost 默认 60s 超时、长操作传 {timeoutMs: KERNEL_TIMEOUT_LONG_MS}（新增长耗时调用点记得放宽）**；**E2E 追加断言前 grep 变量名唯一性，变量改名用唯一新名 + Edit（勿行号 sed）**；**富化日志语义：成功也留痕 stage=ok，失败判定按每文档最近一条（loadEnrichFailedIds）**；**i18n 插入新键的 old_string 要含锚点行并保留（曾丢键被键集合测试暴露）；Svelte 5 嵌套块 null 收窄用 {@const} 局部变量**；**阅读断点 reading-pos 不进派生索引（单文档阅读状态，契约 §3.1a）；Svelte effect 内变量勿与外层重名**；**阅读计时 read-minutes 增量累加不足 1 分钟不写（settleReadingMinutes）；mount effect cleanup 闭包捕获旧依赖值在切文场景正是所需语义（svelte-ignore 抑制告警）**；**LibraryFacet 字段名是 value 不是 name（作者分面单测曾写错）**；**新增纯函数先确认落点域文件再 import；同轮多次编辑同文件前 grep 函数名唯一性（重复定义与放错域文件均已踩坑）**；**编辑函数体后立即 pnpm check 验证闭合结构（showHotkeyHelp 曾丢闭合括号）**；**新类型需显式 import；与字面量联合类型无重叠的比较直接删除（QueueKey 不含 all）**；**Edit 写入后 grep 复查实际落盘内容（曾报成功实未写入/写入损坏，均靠复查发现）**；**接口加字段时同步检查模块内所有字面量构造点（DEFAULTS 曾漏新增字段被 TS 暴露）**；**引述块颜色走块级 IAL custom-clip-hl-color（HL_COLORS 枚举），SQL ial 列不含自定义键——读取必须走 getBlockAttrs 属性端点**。**

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
