# 阅读器与摘录验收矩阵

> T-3210，2026-10-04。代码和隔离回归先固定路径，宿主/真机目视结果仍由 B-0002 记录。

T-3236增补：工作台/浮窗文章与候选的就地原生preview、预览不写状态、候选来源核对/确认/排除/补URL、状态成功后原列表推进、切文和换筛选期间的旧操作隔离。阅读与预览共用ProtyleHost，核对单实例模式切换、容器resize、切文子宿主隔离、晚到初始化、销毁及失败重试/原文入口。引述先回读文章资格与块归属，无定位仅复制。拖条与原生range键盘、关闭/Esc和焦点返回，窄画布与移动全屏sheet安全区另需真机验证。T-3237补更多筛选/动作的原生Popover、已应用chip、Tab/Esc及滚动关闭；这些不由编译/纯函数测试代替。T-1832真实打开时间/内存仍未取得，不启用未经测量的渲染器自动降级。

| 场景 | 代码证据 | 自动化证据 | 真实验收边界 |
|---|---|---|---|
| 正文缺失诊断 | `fulltextBodyState` → “检测正文” → `measureClipBody`；空正文保留原文和快照 | `tests/content-url.test.ts`、ReaderTab/ReadingContext 静态门禁 | 真实文档正文、空正文和权限失败需作者在宿主操作 |
| 原文降级 | 载体策略用 `hasSourceAction`/`sourceUrlForCarrier`；缺 URL 只提示，不伪造打开 | `tests/carrier.test.ts`、`tests/reader-acceptance.test.ts` | 全文、仅链接、本地文档和无效 URL 需桌面/移动走查 |
| 选区摘录 | `selectionchange` 限定正文宿主；定位成功插入引述，失败保留复制 | `tests/reader.test.ts`、`tests/flashcard.test.ts`、静态门禁 | 跨块、图片、代码和宿主选区行为需真实编辑器操作 |
| 制卡 | 选区/高亮复用 `makeQuoteCard` 和拾遗牌组 | `tests/flashcard.test.ts`、制卡 spike | riff 牌组创建、重复和失败提示需真实内核操作 |
| 回跳 | 阅读上下文返回 `openLibraryArticle`；相关旧文切换 `docId` 并清理会话结果 | `tests/reader-acceptance.test.ts` | 桌面页签、原生编辑器切换后滚动/定位需作者核验 |
| 移动动作面 | 原生阅读上下文在窄屏换行成可横向滚动的可见动作条，按钮最小 44px；页签本身仍桌面专属 | `tests/mobile-nav.test.ts`、`tests/reader-acceptance.test.ts` | 手机安全区、长标题、系统大字和动作条误触需 B-0002 |
| 快照与状态边界 | 快照只写 assets 属性；打开、来源、返回和摘录不自动写 `done`；读完才写状态 | `tests/data-sovereignty.test.ts`、ReaderTab/ReadingContext 静态门禁 | 宿主 assets 可写、状态刷新和外部协同需真实操作 |
| 页签键盘流 | 工具条“键盘阅读”聚焦正文，j/k/e/m/x/? 只在阅读焦点且无输入/弹窗/IME 时运行；长按只有滚动可重复 | `tests/reader.test.ts` 单键、修饰键、IME 和重复边界 | B-0002：真实 Protyle 滚动、选区保留、全局快捷键和弹窗冲突，不凭域层测试关闭 |
| 单栏与异步切文 | 专注按钮收起伴生栏；模式/恢复/帮助仍可见，保持同一 Protyle 实例；旧响应不更新新文章 | `tests/prefs.test.ts` 保存/恢复、`tests/reader.test.ts` 请求失效门禁 | B-0002：连续 A→B→A，途中执行状态/AI/快照/下一篇，检查目标和展示；重载后栏状态与滚动可用 |

这轮修复了阅读页签重复渲染“读完并下一篇”的问题，并为快照图标补上名称；移动端阅读上下文继续使用可见动作条，避免把核心动作藏在 hover 或不可发现的菜单中。
