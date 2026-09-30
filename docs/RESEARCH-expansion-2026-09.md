# 扩大调研记录：功能、交互、UI 与性能（2026-09-30）

> 本轮是只读调研，结论只进入待办，不启动功能开发。基线为 v1.1.0、`pnpm test` 132/132、`pnpm check` 0 错误但仍有 Svelte 警告；代码、隔离内核验证和作者真机验收继续分开记账。新属性先修订 `docs/DATA-CONTRACT.md`，新内核端点先做 spike。

## 调研范围与去重

已复核 `TODO.md` 的 T-1740–T-1880、`docs/RESEARCH-folo.md`、`docs/RESEARCH-reading.md`、`docs/UI-STANDARD.md`、`docs/DATA-CONTRACT.md`，并检查 `src/services`、`src/domain`、`src/ui` 和测试。以下任务避开已有的预览窗格、TTS、保存筛选视图、备份恢复、摘录墙、虚拟滚动、归档生命周期、常规 URL 安全和正文质量诊断任务；相邻任务在条目中明确边界。

## 公开资料中的可吸收模式

### 阅读与检索

- Readwise Reader 的 [Filtered Views](https://docs.readwise.io/reader/docs/faqs/filtered-views) 把字段查询保存为视图；[Searching](https://docs.readwise.io/reader/docs/faqs/searching) 覆盖正文、标题和作者，并在离线时回退到设备索引；[Navigation](https://docs.readwise.io/reader/docs/faqs/navigation) 提供可配置侧栏、命令面板、快捷键和可选自动前进；[Appearance](https://docs.readwise.io/reader/docs/faqs/appearance) 提供字号、行距、栏宽、字体和 RTL；[Parsing](https://docs.readwise.io/reader/docs/faqs/parsing) 强调解析版本和显式重新保存，避免静默改写旧内容；[Exporting](https://docs.readwise.io/reader/docs/faqs/exporting) 支持文档、批量 CSV 与高亮导出。
- Raindrop 的 [Search](https://help.raindrop.io/using-search.md) 支持标题、描述、URL、标签、备注、归档正文、PDF/EPUB 和视频转写，结果按类型分组并承认正文索引延迟；[Filters](https://help.raindrop.io/filters) 与 [Broken links](https://help.raindrop.io/broken-links) 把高级条件、链接健康和可忽略结果分开；[Highlights](https://help.raindrop.io/highlights.md) 支持颜色、备注、跳回原文、搜索、删除和导出；[Bookmarks](https://help.raindrop.io/bookmarks.md) 支持手动排序、批量操作和可恢复 Trash。
- Matter 的 [官网](https://getmatter.com/)展示队列重排、离线全文检索、Audio Highlights 与 Quoteshots；GoodLinks 的 [官网](https://goodlinks.app/)展示纯净阅读、彩色高亮、快捷操作和多种导出；Omnivore 的 [README](https://github.com/omnivore-app/omnivore#readme)列出全文搜索、highlight/note、自动保存阅读位置、标签、离线、PDF、RSS、邮件和多端；Folo 的 [README](https://github.com/RSSNext/Folo#features)列出统一时间线、AI 翻译/总结和 article/video/image/audio 多载体。
- Inoreader 的 [查询构建器](https://www.inoreader.com/blog/2023/04/making-complex-searches-easy-with-our-new-query-builder.html)、[Intelligence](https://www.inoreader.com/blog/2025/03/inoreader-intelligence-and-article-summaries-are-here.html)、[Rules](https://www.inoreader.com/blog/2025/10/introducing-new-rule-triggers-and-actions-translations-summaries-and-more.html)和 [read-later/offline](https://www.inoreader.com/blog/2025/06/use-inoreader-as-your-ultimate-read-later-app.html)分别提供条件 AST、多篇报告、用户自定义自动化与离线恢复的参考边界。
- Inoreader 的 [active reading](https://www.inoreader.com/blog/2024/11/build-active-reading-habits.html)展示估计阅读时长、继续阅读、按关键词临时 spotlight、交叉标签和按 feed/date 分组；这些属于阅读视图投影，不能写正文或伪造完成事实。

### 无障碍与交互

- [WCAG 2.2 拖动动作](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)要求拖放操作有单指替代；[目标尺寸](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)给出 24×24 CSS 像素 AA 底线；[Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)和更高等级的[焦点外观](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)要求焦点可见；[ARIA switch pattern](https://www.w3.org/WAI/ARIA/apg/patterns/switch/)定义开关的角色、状态和键盘操作。
- 仓库当前看板只实现 HTML drag/drop，通用焦点样式、移动筛选 sheet、`aria-live`、`prefers-reduced-motion`/`forced-colors` 尚未形成统一基线；小驴打卡已有 44px 控件、容器查询、`overscroll-behavior` 和 `scrollbar-gutter` 可作为内部参考。

## 源码交叉审计证据

- `src/services/clip-store.ts:139-170` 的每次属性写都执行 `loadIndex → applyAttrsToIndex → saveIndex`，多个画布并发时可能以旧索引快照覆盖彼此的增量；`reconcileIndex` 也可能与增量写乱序完成。
- `src/ui/DockPanel.svelte:274-317` 每个画布挂载和 `glean:data-changed` 都启动全量对账，没有请求代次、合并或取消；旧请求完成后可能回滚新视图，也会放大大库 SQL/导出开销。
- `src/services/reader-ai.ts:25-55` 先检查额度、成功后计数；它与富化队列不共用租约，多个伴读动作可以同时越过每日上限，`saveData` 计数也可能丢更新。
- `src/services/clip-store.ts:428-462` 批量属性响应缺少某个 ID 时跳过该行仍提交新索引，与“读取不完整则保留旧索引”的契约不一致。
- `src/services/stats-service.ts:38-40` 的周报只选择 `status === "done"`；归档后保留 `doneTime` 的文章不会进入“本周读完”，需要按完成历史统计。
- `pnpm check:svelte` 当前有约 39 条告警，其中包含拖放/点击元素缺键盘语义、开关缺 ARIA、状态初值反应性和文件输入更新问题；这些不能全部归为同一项 a11y 修复。
- `src/ui/DockPanel.svelte` 的关键词只作用于标题、路径、站点、URL、标签和 AI 标签投影；正文、摘要、引述和批注尚未纳入全文检索。`ReaderTab.svelte` 还有重复“读完并下一篇”按钮及硬编码文案，`ResurfaceView.svelte` 有硬编码状态文字。
- `docs/UI-STANDARD.md` §2.2 规定列表不做 stagger，但 `ResurfaceView.svelte` 仍给每张卡设置动画延迟；§7.1 规定样式集中在 `src/index.scss`，组件中却有大量 inline style（动态宽度/高度之外也有固定视觉样式），形成规范与实现漂移。
- Matter 的 [parser scorecard](https://getmatter.com/how-matter-approaches-parsing) 用人工校订样本、字段加权和漏段惩罚监测解析质量；[contextual search](https://getmatter.com/updates/contextual-search) 将库内全文与文档内查找都作为离线能力，可作为本插件解析回归与检索验收的量化参考。

## 去重后的执行顺序

P0/P1 优先处理数据一致性、统计事实、检索基础和移动/键盘可用性；P2 用于阅读质量、查询表达能力和用户可控扩展；P3 保留为载体、离线、实体和自动化研究池。所有任务只入账，开发前仍需作者点单。

