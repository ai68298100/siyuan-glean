# GitHub 高 Star 同类项目参考（2026-09-30）

本轮只读检索 GitHub 仓库 API 与项目 README/公开文档，目的是把可借鉴的产品做法转成待办；没有运行第三方服务、复制代码或修改本插件功能。Star、许可证和是否归档均为 **2026-09-30 快照**，不代表长期状态；Star 是受关注程度的线索，不是功能质量证明。下列仓库在查询时均未标记 archived。功能描述只代表公开文档声明，实施前仍须针对思源做契约、spike 和验收。

## 与文章收集和稍后读最接近

| 项目（GitHub Star 快照） | 公开资料中可核实的做法 | 对本插件的参考边界 |
|---|---|---|
| [Karakeep](https://github.com/karakeep-app/karakeep)（29,357） | 链接、笔记、图片/PDF 一起收集；全文及语义搜索、OCR、可选 AI 标签/摘要、移动离线、RSS 自动收集、亮点、REST API 和多源导入，见 [README](https://github.com/karakeep-app/karakeep#readme)。 | 先研究内容类型和索引来源、可解释的搜索命中、导入保真与离线失败；语义搜索/OCR 只能作为可选研究，遵守成本与隐私边界。 |
| [Linkwarden](https://github.com/linkwarden/linkwarden)（19,874） | 自动保留截图、PDF 和单文件 HTML；Reader 视图、高亮/批注、可选 Wayback Machine 快照、集合/子集合、标签、全文搜索及 RSS 订阅，见 [README](https://github.com/linkwarden/linkwarden#readme)。 | 对照“思源正文 / 原网址 / HTML 快照”三个入口在失联、重剪藏和归档后的可用性与体积；集合层级不能直接当作本插件五态。 |
| [Omnivore](https://github.com/omnivore-app/omnivore)（16,269） | 高亮/笔记、键盘导航、长文自动记住阅读位置、PDF、离线、跨端和 RSS 分类，见 [README](https://github.com/omnivore-app/omnivore#readme)。 | 断点与状态必须分离，打开或滚动不等于读完；现有 Pocket/Omnivore/wallabag 导入只覆盖部分字段，需核验批注与时间保真。其云服务已在 2024-11 停用，当前 README 说明为完全自托管项目。 |
| [wallabag](https://github.com/wallabag/wallabag)（12,991） | 网页正文抽取、稍后读与自托管，见 [README](https://github.com/wallabag/wallabag#readme)；本插件已有其 JSON 导入。 | 重点回测导入后的状态/标签/时间、正文解析失败与原链接退路，不重复建设第二套保存服务。 |
| [Shiori](https://github.com/go-shiori/shiori)（11,657） | Pocket 风格书签，支持 Netscape HTML/Pocket 导入，尽可能提取可读正文并离线归档，提供 reader/archive 双模式，见 [README](https://github.com/go-shiori/shiori#readme)。 | 研究轻量书签导入与“可读正文/忠实快照”两种保留方式的差别；坚持用户确认收录和原文不静默覆盖。 |
| [linkding](https://github.com/sissbruecker/linkding)（11,263） | 极简标签书签；自动补标题/描述/图标、本地 HTML 或 Internet Archive 存档、Netscape HTML 导入导出、REST API，见 [README](https://github.com/sissbruecker/linkding#readme)。 | 可借鉴导入预览、元数据来源标记和本地快照覆盖率；外部服务/公开存档不得默认上传用户文章。 |
| [Memex](https://github.com/WorldBrain/Memex)（4,722） | 网页/PDF 批注，书签全文检索及时间/域名/列表/标签过滤、离线移动阅读和加密同步，见 [README](https://github.com/WorldBrain/Memex#readme)。 | 参考批注正文与文章来源同搜、列表筛选和移动端阅读；GitHub API 的 `pushed_at` 为 2025-12，且未给出标准许可证标识，不能照搬实现。 |
| [Hypothesis 服务端](https://github.com/hypothesis/h)（3,183） | 通用网页批注服务；客户端单独位于 [hypothesis/client](https://github.com/hypothesis/client)。 | 参考 [W3C Web Annotation](https://www.w3.org/TR/annotation-model/) 的 body/target/selector 概念，尤其原文 exact/prefix/suffix 锚点；不能当作 `siyuan-comment` 的公开协议。 |
| [WebScrapBook](https://github.com/danny0838/webscrapbook)（1,238） | 浏览器扩展将网页按多种格式保存到本机或后端，并支持后续整理、批注和编辑，见 [README](https://github.com/danny0838/webscrapbook#readme)。 | 作为快照保真与资源失效的专项参考，不增加默认爬取或云端归档。 |

这些项目的 GitHub API 许可证标识依次为 AGPL-3.0、AGPL-3.0、AGPL-3.0、MIT、MIT、MIT、Memex 未标识、BSD-2-Clause、MPL-2.0；本轮只借鉴功能与交互，不移植代码。

## 相邻领域中可迁移的模式

| 项目（Star 快照） | 可用参考及边界 |
|---|---|
| [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx)（46,176） | 可搜索文档归档与批处理的参照；本插件仅研究扫描件/OCR 是否值得接入现有思源资源，不做通用文档管理器。其 [README](https://github.com/paperless-ngx/paperless-ngx#readme) 链接完整功能文档。 |
| [KOReader](https://github.com/koreader/koreader)（30,012）、[Koodo Reader](https://github.com/koodo-reader/koodo-reader)（28,343）、[Readest](https://github.com/readest/readest)（24,726） | 电子书阅读器可参考高亮导出字段、并排阅读、屏读/键盘、跨端断点和窄屏操作；本插件当前主链是思源文档中的文章，EPUB/PDF 阅读内核不纳入现阶段目标。 |
| [FreshRSS](https://github.com/FreshRSS/FreshRSS)（16,181）、[Miniflux](https://github.com/miniflux/v2)（9,760） | 前者公开文档包含标签、客户端 API、OPML/分享；后者 README 明列 Atom/RSS/JSON Feed、OPML 导入导出、全文检索、移动适配和条件轮询。它们用于研究从订阅器**单向转入用户选定文章**的可行性；D-0022 当前排除了内建 RSS 订阅服务。 |
| [Zotero](https://github.com/zotero/zotero)（15,430） | 收集/整理/批注/引用研究材料的参考；可研究外部批注身份、PDF 与出处保真，文献管理与引文格式不纳入本插件主链。 |
| [Monolith](https://github.com/Y2Z/monolith)（15,503） | 单文件 HTML 网页保存工具；可作为当前 `exportHTML → assets` 快照的保真度、资源依赖和体积对照，不直接在插件中打包外部命令行程序。 |
| [Mozilla Readability](https://github.com/mozilla/readability)（11,474） | 网页正文抽取库，可作为 T-1914 解析质量样本的对照基线；本插件继续优先使用思源官方剪藏，不直接替换其解析链路。 |
| [Obsidian Weread Plugin](https://github.com/zhaohongxuan/obsidian-weread-plugin)（2,262） | README 明列公众号文章划线/笔记、详情页和 deeplink，也明确同步文件是**覆盖式更新**。可研究用户手动导入与来源回跳，不能引入覆盖用户编辑的同步。 |
| [Obsidian Annotator](https://github.com/elias-sundqvist/obsidian-annotator)（1,774）、[ZotLit](https://github.com/aidenlx/zotlit)（1,024） | 前者将批注放在本地 Markdown 引述块、用块链回跳，也公开说明源 PDF/EPUB 改名会断链；后者以侧栏跟随阅读器并只读整合 Zotero 注释。可用于外部批注身份、锚点失联修复和侧栏刷新设计，不复制其格式。 |

上述项目的 GitHub API 许可证标识分别为 GPL-3.0、AGPL-3.0、AGPL-3.0、AGPL-3.0、AGPL-3.0、Apache-2.0、Zotero 未给出标准 SPDX、CC0-1.0、Apache-2.0、MIT、AGPL-3.0、AGPL-3.0。功能资料以各仓库 README 为主；RSS 与批注类的具体接口仍需后续单独核验。

## 转为待办的共性问题

1. **保存不等于保全**：网页可消失、抽取正文可缺图表、本地 HTML 可有资源断链。待办分别要求覆盖率盘点、原文/正文/快照三入口退路、失败恢复和重剪藏版本裁决（衔接 T-1896/T-1898/T-1849）。
2. **阅读事实与视图状态分开**：Omnivore 的位置记忆可启发断点，但本插件的 `reading`/`done` 和 `custom-clip-done-time` 仍须由显式动作维护；视图百分比需先有数据契约（T-1728/T-1746）。
3. **外部批注需要稳定锚点和身份**：`siyuan-comment` 当前只读适配方案增加 provider/externalId、块 ID 与 W3C Text Quote Selector 的恢复线索；来源删除、正文改写、跨文档移动后须能显示失联并人工处理（T-1918–T-1929）。
4. **检索须解释“搜到什么”**：标题、正文、快照、引述、外部批注、OCR 和语义结果具有不同事实来源与索引延迟；分面/排序和结果跳转按来源标记，不能把 AI 推断内容冒充正文（T-1894/T-1895）。
5. **导入优先保真与可逆**：Netscape HTML、第三方 JSON/CSV、公众号划线等只作为未来研究输入，逐条预览、URL 去重、未知字段保留或报告、来源 ID 幂等和手填字段保护先于批量写入（T-1897）。
6. **功能边界**：不因其他项目 Star 高就引入云账号、协作、内建 RSS 订阅、通用电子书阅读器、公开分享、独立 OCR/爬虫服务或自动上传 Internet Archive。新增属性先修 DATA-CONTRACT，新端点先 spike，AI 与外部同步默认关闭。

具体研究与验收任务已入 `TODO.md` 的 T-1935 起；以上均未开发，产品可用性仍要通过本插件的隔离测试与作者真机验收判断。
