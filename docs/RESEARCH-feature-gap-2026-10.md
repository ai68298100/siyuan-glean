# 功能差距调研（2026-10-09）：对标 Readwise Reader / Cubox / 简悦

> T-3317 附属调研。只读检索公开资料（部分被限流，闭源产品以官方文档与公开评测为准），对照本插件能力矩阵（`CAPABILITY-MATRIX.md`）与 2026-09-30 的开源项目调研（`RESEARCH-github-reference-products-2026-09.md`）做增量差距分析。所有建议只立项不排期（作者点单驱动）；实施前照例先修数据契约、再 spike、再验收。

## 一、对标产品与素材

| 产品 | 定位 | 本轮关注点 |
|---|---|---|
| [Readwise Reader](https://readwise.io/read)（闭源标杆，[功能页](https://play.google.com/store/apps/details?id=com.readermobile&hl=en_US)、[更新日志](https://readwise.io/changelog)） | 全内容类型稍后读 | 库级 AI 对话（[chat with library](https://apps.apple.com/vn/app/readwise-reader/id1567599761)）、TTS 一级功能、PDF Clean View、RSS、[每日回顾与间隔重复](https://docs.readwise.io/readwise/docs/faqs/reviewing-highlights)、[千日 streak 惯例](https://blog.readwise.io/adding-intention-to-spaced-repetition/) |
| [Cubox](https://help.cubox.pro/hi/1dea)（中文市场） | 开箱即用收藏盒 | 收集入口多样性、[标注独立浏览与搜索](https://story.cubox.pro/cubox-reader)、[稳定导出](https://help.cubox.pro/share/d70f) |
| 简悦 SimpRead（[少数派评述](https://sspai.com/post/71926)、[腾讯新闻](https://news.qq.com/rain/a/20220506A04B6B00)） | 重配置重导出 | 阅读模式批注、导出到大量第三方、AI 阅读辅助；安卓弱 |
| 开源参考（[前轮调研](RESEARCH-github-reference-products-2026-09.md)） | Karakeep/Linkwarden/Omnivore 等 | 已立项 T-1935 起；本轮不重复 |

通用背景：Pocket 已于 2025-07 关停（导入链路价值上升）；Instapaper/GoodLinks 导出弱；wallabag 支持 EPUB 导出；Matter 导出受限。

## 二、本插件已有的强项（对比后确认不落后）

- **数据主权架构**：一切状态在思源文档属性，无独立数据库、无云端账号——Readwise/Cubox 均为云端闭源，这是本插件的根本差异化。
- **重浮方法论**：今日拾遗（确定性算法 + 置顶 + 滑动 + 撤销 + why 解释）对应 Readwise Daily Review 的"重新浮现"，且不依赖黑盒算法。
- **知识沉淀闭环**：摘录 → 颜色 → 分享卡 → riff 制卡（间隔重复由思源 riff 承载）→ 周月年回顾 + 热力图。
- **AI 边界克制**：逐功能默认关、每日额度共享、多通道、问文章/问选区——与"AI 全面侵入"形成对照。
- **导入承接**：Pocket 关停后，Pocket HTML/CSV 导入链路（含状态/时间/标签映射）价值上升，本插件已覆盖。

## 三、差距与强化建议（只立项，作者点单）

### 第一梯队：低成本强化已有功能（建议优先）

| 编号 | 建议 | 对标 | 说明 |
|---|---|---|---|
| T-3330 | **连续阅读天数 streak** | Readwise 千日 streak | 统计域已有按日完成/阅读事实，只需按日历聚合出"连续 N 天"并在今日拾遗/统计页展示；可与打卡桥联动但必须独立成立（打卡插件不装也有 streak）。平静原则：不弹窗、不断签惩罚，只陈述事实。 |
| T-3331 | **今日拾遗"换一篇"** | Reader 的 shuffle/next | 当日清单不满意时从"已 surfaced 排除池 + 未入清单"随机补位一篇（保持每日数量与平静口径，替换动作可撤销可追溯）。 |
| T-3332 | **快照覆盖率治理入口** | Linkwarden 的存档率视图 | 统计快照覆盖（已有快照/可快照），在治理提醒中提供"为无快照文章批量补拍"入口（沿用单篇快照服务与失败重试语义，不改变自动快照默认关）。 |
| T-3333 | **单篇导出 Markdown 文件** | 简悦/GoodLinks | 读库行/预览动作：把文章元数据+正文导出为单个 .md 文件下载（与整理稿/回流互补，面向"搬去别的系统"场景）。 |

### 第二梯队：中成本新能力（对标标杆，需要 spike 或契约先行）

| 编号 | 建议 | 对标 | 说明 |
|---|---|---|---|
| T-3334 | **库级 AI 问答（问整个读库）** | Readwise chat with library | 现有"问文章/问选区"是单篇；升级为基于读库索引（标题/摘要/标签/嵌入已可选）的检索式问答，答案必须列出来源文章并可跳转。AI 额度共享、默认关；语义检索依赖嵌入基建（已有）。需要先做检索证据契约，防 AI 冒充正文。 |
| T-3335 | **全库 Markdown 归档导出** | wallabag EPUB / 简悦导出生态 | 在 JSON 备份之外提供人可读的全库 Markdown 归档（每篇一文件 + 索引），面向"离开本插件也要带走"的最终退路。注意导出保真与体积分卷。 |
| T-3336 | **阅读位置百分比显示** | Omnivore 位置记忆 | 现有书签是块级；补"读到全文约 X%"的轻量展示（T-1728/T-1746 已有数据契约缺口先修）。 |
| T-3337 | **TTS 朗读增强** | Reader TTS | 现有浏览器 TTS 折叠在辅助工具；加"从上次朗读处继续/语速与音色记忆"（T-1744 spike 既有结论上增强）。 |

### 第三梯队：明确不做（边界，记录备查）

- **内建 RSS 订阅聚合**：D-0022 已排除；FreshRSS/Miniflux 单向转入仅作未来研究。
- **PDF/EPUB 阅读内核**：主链是思源文档中的文章，不引入第二阅读内核。
- **云端同步 / 公开分享 / 上传 Internet Archive**：与数据主权方向相反。
- **高亮同步回第三方服务**：Pocket 已关停；方向是"外部进思源"，不做"思源出外部"。
- **OCR / 语义搜索服务**：仅在嵌入基建上作可选研究，不建独立服务。

## 四、结论

- 本插件在"数据主权 + 重浮方法论 + 沉淀闭环"上有明确差异化，不需要追平 Readwise 的内容类型广度。
- 最值得补的是**激励层（streak）**、**重浮灵活性（换一篇）**、**治理完整性（快照覆盖）**、**退出保障（Markdown 归档）**——全部是对已有功能的强化，不引入新内容类型或服务。
- 库级 AI 问答是唯一的中成本新能力，建议在嵌入基建验证（B-0004）后再立项实施。
