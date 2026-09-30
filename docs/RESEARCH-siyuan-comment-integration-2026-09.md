# `siyuan-comment` 联动调研（2026-09）

## 调研范围与证据

本轮只读检查了 `https://github.com/HaoCeans/siyuan-comment` 的公开仓库、README、v2.9.4 Release 包和本插件现有的阅读/高亮链路，没有修改功能代码，也没有向外部插件发送请求。

- 当前 Release：`v2.9.4`，发布日期 2026-09-28，`minAppVersion=3.8.4`，桌面/浏览器/移动端均声明支持，`disabledInPublish=true`。
- Release `package.zip` SHA-256：`ae80257abf78348ead3c2faa176f7f4e7b1bfe759faa889492af752d5a333fe1`。
- 发布包只有编译后的 `index.js`、CSS、i18n、manifest 和说明材料，没有可依赖的公开源码或 TypeScript 类型。
- README 声称：选中文字批注、DOM 下划线不污染正文 Markdown、批注可放在原文档底部/今日日记/目标文档/子文档、侧栏搜索与跳转、Protyle 富文本编辑、移动端滑动批注、卸载后块和引用仍保留。

结论：可以做“只读数据适配器 + 正常思源界面路由 + 内置基础降级”，不能把编译包里的私有函数、DOM 结构或事件当作跨插件契约。

## 已确认的数据形态

v2.9.4 的批注块以 IAL 标识，核心字段如下。字段名来自发布包中的实际字符串，最终实现前仍需隔离内核 spike 复核响应和版本差异。

| 位置 | 字段 | 作用与注意 |
|---|---|---|
| 批注块 | `custom-siyuan-comment="true"` | 批注块主标识 |
| 批注块 | `custom-comment-source=<block-id>` | 被批注的来源块 ID，可能跨文档失效 |
| 批注块 | `custom-comment-text` | 选中文字缓存；可能含 `_esc_newline_` 等编码，不是批注正文唯一事实源 |
| 批注块 | `custom-comment-before` / `custom-comment-after` | 来源文字邻接上下文，用于恢复定位 |
| 批注块 | `custom-comment-seq` / `custom-comment-highlight-index` | 批注顺序和来源块内高亮序号 |
| 批注块 | `custom-comment-tag` | 外部插件标记分类 |
| 批注块 | `custom-comment-replies` | 回复数据，需按不可信 JSON/文本处理 |
| 批注块 | `custom-comment-highlight-style` / `custom-comment-highlight-decoration` / `custom-comment-highlight-custom-color` | 高亮样式，仅作为展示元数据 |
| 批注块 | `custom-comment-block-hidden` | 外部插件的显示状态 |
| 批注块 | `custom-comment-group` / `custom-comment-group-master` | 多块批注分组关系 |
| 来源块 | `custom-comment-refs=<id,id,...>` | 逗号分隔的批注块 ID；这是批注放到其他文档时回溯来源的关键索引 |
| 宿主/区域 | `custom-comment-child-doc` | 来源文档与批注子文档的关系缓存 |
| 宿主/区域 | `custom-siyuan-comment-zone` / `custom-siyuan-comment-enabled` | 批注区和已启用文档的标识 |

批注正文应读取批注块的 `markdown`/kramdown，再去除块 IAL 和引述转义；`custom-comment-text` 主要是被标记的原文。选中文字优先从当前 DOM 的 `[custom-comment-id]` 读取，失效时再用 IAL 和来源块上下文兜底。所有值都必须转为纯文本或经受控 Lute 渲染，不能把外部 Markdown/IAL 直接塞进 `innerHTML`。

正文高亮是运行时 DOM 标记（例如 `custom-comment-id`、样式/线型属性），不是本插件可以永久依赖的 Markdown 语法。批注块可能与文章不在同一个 `root_id`：原文底部、今日日记、指定目标文档和子文档都是合法放置位置。

## 文章到批注的只读聚合方案

外部插件自身的聚合逻辑给出了可复用的查询方向：

1. 在文章 `root_id` 内查询 `custom-siyuan-comment="true"` 的批注块。
2. 在文章及其来源块中读取 `custom-comment-refs`，解析后按 ID 分批查询批注块；这样可以找到放在日记、目标文档或子文档中的批注。
3. 对每条批注补查批注块 `root_id`、来源块 `root_id`、来源块是否仍存在、批注块是否仍存在，并产生 `sourceRootId`、`commentRootId` 和 `orphan` 状态。
4. SQL 的 `LIKE` 只用于缩小候选范围，IAL 必须再次精确解析；ID 必须通过合法思源块 ID 校验并正确转义。批量查询建议每批不超过 200 个 ID，并处理内核索引异步刷新。
5. 排序优先使用来源文档树序和 `custom-comment-seq`，再退化到批注 `created` 与 ID；结果要标记排序来源，不能把缓存顺序冒充正文顺序。

本插件现有 `services/highlights.ts` 会把当前文档的普通引述块聚合为高亮。接入外部批注后需要区分 provider，过滤已经识别的外部批注区，避免把批注插件的引述结构再计入普通摘录；现有 `custom-clip-highlight` 形态和普通引述块仍保留为独立来源。

## 联动入口与可靠边界

发布包没有发现稳定的 `getComments`、`openPanel` 或插件实例桥接 API。可见的全局函数只有调试/诊断用途，例如 `siyuanCommentEnableDebug`、`siyuanCommentDisableDebug`、`siyuanCommentHighlightSnapshot` 和列表排序调试开关；它们不能用于产品联动。

编译包中出现了以下实现细节，但只能作为 spike 的观察线索：

- Dock 类型 `siyuan-comment-panel`；命令名 `addComment`、`openCommentInProtyle`、`aiAssistant`。
- 私有 DOM 前缀/容器：`.siyuan-comment-*`、`#siyuan-comment-app`、`.siyuan-comment-popover`；批注弹窗内部有 `siyuan-comment-popover__protyle`。
- 私有刷新事件：`siyuan-comment-updated`、`siyuan-comment-settings-updated`、`siyuan-comment-panel-refresh`、`siyuan-comment-render-refresh`、`siyuan-comment-pin-updated`。

这些名称没有版本化保证。后续只允许在版本校验后把私有事件作为可选刷新提示，不能依赖它们完成正确性；正确性必须来自内核只读查询和本插件自己的 `glean:data-changed`/Protyle 生命周期。阅读宿主扫描应排除 `.block__popover`、`[class*="popover"]` 和 `[class*="siyuan-comment-"]`，避免把外部批注弹窗误当普通正文；这也是第三方浮动目录插件对 v2.8.x 实测后的兼容做法，但仍不是官方 API。

本插件当前 `src/ui/reading-context-controller.ts` 会对 `loaded-protyle-static`、`loaded-protyle-dynamic`、`switch-protyle` 直接调用 `attach`，尚未有外部批注弹层守门；由于外部批注弹窗内部也创建 Protyle，这个现状应作为 T-1934 的独立缺陷先验证。

## 产品联动方案（待开发前的候选契约）

### 已安装且可用

- 阅读文章仍打开正常思源编辑器，让外部插件自己的工具栏、快捷键和批注 Dock 接管创建/编辑体验。
- 本插件的阅读伴生栏只读显示 `siyuan-comment` 批注，标出“外部批注”来源，提供跳来源块、跳批注块和打开原生批注 Dock 的导航。
- 内嵌 ReaderTab 是否能被外部插件识别，必须先做真机 spike；若不兼容，阅读动作回退到原生思源页签并提示用户使用批注 Dock。不能私自调用其 `siyuan-comment-panel` 内部对象。

### 未安装、未启用、版本不兼容或发布前端

- 保留本插件已有的最基础能力：选区摘录为引述块、复制选区、引述块高亮只读聚合。
- 只在合适的空态/设置中推荐安装“鲸鱼快速批注”，提供集市和 GitHub 链接、版本要求与关闭推荐选项；推荐失败不阻断阅读。
- `disabledInPublish=true` 的发布/只读前端必须走内置只读路径，不能把“已安装”误判成可用。

### 写入边界

本插件不写、不删除、不移动 `custom-comment-*`，不覆盖外部批注块正文，不把外部 AI 解释、标签或闪卡自动复制到 `custom-clip-summary`/`custom-clip-ai-tags`。若将来提供“保存为本插件摘要/制卡”等动作，必须由用户显式触发，并沿用 D-0013/D-0015 的额度、隐私和来源标记规则。

## 风险与需要验证的事项

- v2.9.4 编译包不是稳定 SDK，字段、存放位置和事件可能改变；需保留 unknown/unsupported 状态，不显示伪评论。
- 历史 `siyuan-comment` 实现曾使用 `custom-quote-*`、`custom-<quoteId>` 和 `siyuan://blocks/<id>`，与当前 `custom-siyuan-comment` 契约不同。是否兼容存量数据必须先 spike，不能把两套字段混写。
- 删除、移动、同步冲突、权限不足会造成来源块/批注块孤儿；只读聚合必须可解释、可重试，不得修复性写回外部属性。
- 批注 Markdown、回复、IAL 和来源标题都是不可信输入；渲染、链接、回链和跨文档跳转必须做安全过滤。
- 1k/10k 批注时不能每条串行读属性；需要分页、批读、缓存、请求代次、取消和事件去抖，并保留全量重建兜底。

## 建议的实施顺序

按 TODO T-1917–T-1934 执行：先固定只读数据契约和隔离 spike，再做 adapter/read service，之后接 ReaderTab/高亮 UI 和阅读路由，最后补安装推荐、生命周期、性能、安全、多端、上游 bridge 协作和现有宿主排除。代码实现前不得把上述候选契约写成已支持能力或 README 承诺。

## 参考链接

- [siyuan-comment README](https://github.com/HaoCeans/siyuan-comment#readme)
- [v2.9.4 Release](https://github.com/HaoCeans/siyuan-comment/releases/tag/v2.9.4)
- [plugin.json](https://github.com/HaoCeans/siyuan-comment/blob/main/plugin.json)
- [floating-toc 的批注弹层排除实证](https://github.com/shuojie819/siyuan-floating-toc-plugin/blob/001b05a5450821083b00d6ebab54cb5c65461531/src/utils/domUtils.ts#L263-L308)

