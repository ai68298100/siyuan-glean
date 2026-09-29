# 数据契约（DATA-CONTRACT）

> 本文档是小驴拾遗"生产数据边界"的唯一事实源。改任何一条存储/字段约定，先改这里。
> 全部端点形状经 M0 spike 在思源 v3.8.5 真内核实证（`scripts/spike/`，报告见 `docs/spike-report.md`）。

## 0. 数据主权划分

| 数据 | 存放位置 | 插件卸载后 |
|---|---|---|
| 文章状态（五态/评分/优先级/摘要/AI标签/重浮记录） | 文档属性（根块 IAL，`custom-clip-*`） | **仍在**（思源内核数据） |
| 用户自己的标签 | 根块 IAL `tags`（官方剪藏写入位） | 仍在；外部导入仅在新建文档时带入文件标签，之后插件不覆写 |
| 派生索引 `glean-index.json` | 插件 saveData | 随插件删除，可随时重建 |
| 迁移任务进度 `migrate-progress.json` | 插件 saveData | 随插件删除；仅用于暂停、恢复与失败重试，文章属性仍是事实源 |
| 插件设置 | 插件 saveData | 随插件删除 |

## 1. 属性规范（文档级，根块 IAL）

`src/domain/schema.ts` 为唯一事实源；本表与其同步维护。

| 属性 | 类型 | 说明 |
|---|---|---|
| `custom-clip-url` | string | 来源 URL（收录时尽量回填；迁移启发式或手填） |
| `custom-clip-site` | string | 站点名（可空） |
| `custom-clip-time` | string | 待阅读等待时间的基准时刻 `YYYYMMDDHHmmss`（本地时区）：外部导入/收集箱优先原服务收藏时间；旧文回填使用文档 ID 创建时间作为估计；普通显式收录或无可用来源时使用首次收录时刻。与 `time-source` 一起解释，不把所有值称为“首次入库时间” |
| `custom-clip-time-source` | enum | `source`（原服务收藏时间） / `document`（文档 ID 创建时间估计） / `capture`（首次收录操作时刻） / `legacy`（历史值无可靠来源）。旧非空 time 不自动重写，缺来源时只在读取投影为 legacy |
| `custom-clip-status` | enum | `inbox` / `later` / `reading` / `done` / `archived`（D-0003 五态） |
| `custom-clip-done-time` | string | 完成时间 `YYYYMMDDHHmmss`（本地时区）：仅由用户显式“标记读完”动作写入，或导入时来自导出文件中的可靠已读时间（Pocket `time_read`）；离开 `done`（归档/恢复/重读）不抹除，再次显式标记读完时覆盖为最新时刻；缺键 = 完成时间未知（D-0028） |
| `custom-clip-content-type` | enum | `fulltext`（本地有正文） / `link`（仅来源链接） / `local`（用户明确加入的本地文档）；已有文档缺字段时显示“类型未确认”，不凭 0 字推定全文 |
| `custom-clip-words` | number | 本地正文字数：剥除标题、来源链接/元信息、代码与图片后按中英混排统计；仅链接为 0，缺键表示未统计 |
| `custom-clip-minutes` | number | 预计本地阅读分钟 = round(words/400)，有正文至少 1；仅链接为 0，缺键表示未知，界面不显示伪精确 0 分钟 |
| `custom-clip-priority` | number 1-5 | 手动优先级（重浮加权用，默认 3，用户手填字段） |
| `custom-clip-rating` | number 0-5 | 读后评分（可选，用户手填字段） |
| `custom-clip-ai-tags` | string | AI 标签（逗号分割，与用户 `tags` 完全隔离，永不覆盖用户 tags） |
| `custom-clip-summary` | string | AI 一句话摘要 |
| `custom-clip-last-surfaced` | string | 最近一次被重浮的日期 `YYYYMMDD` |
| `custom-clip-snapshot` | string | 单文件 HTML 快照的 assets 路径（T-1504，防内容/链接腐烂） |
| `custom-clip-src` | string | 来源管道：`web-clipper`/`inbox`/`manual`/`migration`/`import-*` |
| `custom-clip-excluded` | boolean | 用户明确判定“不是文章”的持久标记；`true` 时不再提示候选，用户显式收录可清除 |
| `custom-clip-internal` | boolean | 本插件自己生成的周报、数据库、闪卡宿主标记；仅排除未收录候选与迁移预览，不抹除已有有效状态的文章 |

写入规则：

1. 统一经 `services/clip-store.ts`（T-1100）读写，带 schema 校验与幂等；其余代码不得裸调 attr 端点写这些键。
2. 删除属性传 `null`（内核语义）。
3. 数字属性以字符串形态存入 IAL（内核 IAL 值均为字符串），读取时按 schema 还原类型。
4. 用户手填字段（`custom-clip-url` 已有值 / `custom-clip-status` / `custom-clip-priority` / `custom-clip-rating`）AI 富化与迁移器一律不覆盖；AI 只写 `custom-clip-ai-tags` / `custom-clip-summary`。
5. 迁移幂等：已带 `custom-clip-url` 的文档整体跳过，不重写时间戳。
   只有 `custom-clip-status` 而缺 URL 的旧文属于待补全行：保留原状态，只回填来源与缺失元数据；执行期不能把它误判为已完成。
6. 面板、看板、命令中由用户明确发起的改状态可覆盖已有 `custom-clip-status`，必须以实际写入成功数反馈；扫描、迁移与 AI 的自动写入仍受第 4 条保护。外部导入的新建文档可以在首次收录时写入导出文件状态。
7. 仅有 `custom-clip-url` 而无有效状态的文档是待补全的半成品；显式收录须保留已有 URL，补齐状态等缺失字段。已有有效状态才视为收录幂等跳过。
8. `captureClip` 只消费入口已取得的 Markdown 或显式内容类型，不暗中额外导出正文。手动、候选及右键入口统一经 `captureDocument` 先导出 Markdown；导入、收集箱和迁移入口传入已有 Markdown。`domain/content.ts` 只把明确 URL 或高置信模板/独立 URL 行当来源，普通行内链接不是来源；正文失败时可以收录但缺失项必须可见。导入器生成的元信息不计作全文，外部链接导入显式为 link。已有非空 time 一律保留；旧值无来源不自动写入 legacy，只作为读时投影。
9. 所有显式收录入口在写入前以 `normalizeUrl` 检查库内已有来源。发现同 URL 时默认不创建第二份，返回已有文档供界面打开核对；用户明确选择“仍保留第二份”后才允许写入。查重扫描分页未完整成功时必须报错并停止，不能以部分结果判定无冲突。用户显式收录同时可解除此前的 `custom-clip-excluded=true`。
10. `custom-clip-done-time` 只描述最近一次显式完成（D-0028）：`clip-store` 的显式状态动作把状态写成 `done` 时写入当前时刻；归档、恢复或重读都不删除旧值，`archived` 保留“读过”事实。旧数据、无已读时间的外部导入缺键即“完成时间未知”；聚合层（`domain/stats.ts`）的时间性统计（本周完成、周报列表）只按完成时间计，无完成时间的已读只计入状态总数，不得用文档 `updated` 或迁移当天伪造。正文测量（T-1727）只允许显式动作触发：导出正文后按 `domain/content.ts` 规则重算 `words/minutes` 并写回，不修改用户正文，不删除既有快照；“重新剪藏”是打开原文让用户用官方剪藏扩展重剪的显式导航，插件不静默覆盖文档内容。

### URL 比较键（D-0020）

`domain/url.ts` 的 `normalizeUrl` 是所有文件内去重、预览/执行期库内去重与来源候选合并的唯一比较规则：只接受 http(s)，trim，规范协议和主机大小写，移除默认端口、fragment 与非根路径末尾斜杠，保留路径大小写与 query 的顺序和值。无效 URL 返回空比较键。比较键不反写 `custom-clip-url` 或用户正文，原始来源链接保持可见；语义相似不参与自动精确拒收。

## 1.1 阅读载体与打开策略（S3，T-1716/T-1722）

`custom-clip-content-type` 是阅读入口的唯一载体事实源；它不新增状态，也不因用户点击打开而改变五态：

| 载体 | 主打开动作 | 来源网页动作 | 缺失提示 |
|---|---|---|---|
| `fulltext` | `openTab({doc:{id}})` 打开思源正文 | 有效来源 URL 时可提供“打开原文”次级动作；不改变主打开目标 | 正文已在文档内，按属性展示全文徽章 |
| `link` | 优先提供“打开原文”来源网页动作；文档标题仍可打开思源链接说明 | 仅当 `custom-clip-url` 通过 `normalizeUrl` 校验为 `http(s)` 时显示；使用用户原始 URL，点击不写状态 | URL 缺失或非法时显示“来源链接缺失”，不渲染网页按钮 |
| `local` | `openTab({doc:{id}})` 打开思源本地文档 | 不显示网页按钮，即使文档正文中偶然存在链接 | 按属性展示本地文档徽章 |
| 未知/缺字段 | `openTab({doc:{id}})`，并展示“正文类型未知” | 不显示网页按钮，直到载体和 URL 由用户确认 | 保留未知徽章，不凭字数 0 推断类型 |

实现约束：思源 `openTab` 的公开类型只支持文档、资产、搜索、卡片和插件页签，没有外部 URL 目标；来源网页由用户点击时调用宿主浏览器标准 `window.open`。全文和仅链接载体可以在来源 URL 有效时提供来源网页动作，但全文的主动作始终是思源正文，仅链接的主动作才是来源网页；local/unknown 不显示网页动作。UI 必须先用 `domain/carrier.ts` 校验载体和 `normalizeUrl`，禁止拼接 `javascript:` 等非 `http(s)` 协议。打开文档、打开来源、打开快照均是阅读导航动作，不自动把 `inbox/later/reading` 改为 `done`；“标记已读”仍是独立显式动作。

## 2. 文章识别：双锚点

- **主锚点**：设置中指定的"读库笔记本"（可多个，存 `anchorNotebooks`）。
- **次锚点**：任意笔记本中带 `custom-clip-url` 的文档（SQL `ial LIKE '%custom-clip-url%'` 圈定，属性精确值走 attr 端点读）。
- 锚点笔记本 ID 必须作为 SQL 字符串字面量逐个引用并转义；任一范围查询失败须向界面报告，不能把失败结果呈现为“0 篇”。
- **辅助标签扫描**：当前版本扫描任意笔记本带 `#剪藏` 标签的文档，作为未收录候选来源；标签名目前固定为“剪藏”。SQL `LIKE` 只扩大扫描范围，最终由根块 `tags`/查询 `tag` 的精确 token 校验决定候选资格。
- **S2 候选资格**：扫描范围本身不构成文章证据。无有效五态状态的文档，须满足以下至少一种证据才进入待确认候选：有效的 http(s) `custom-clip-url` 属性；根块 `tags` 或 SQL `tag` 中完整的 `剪藏` 标签；文档正文前 10 行中的官方剪藏模板独立链接行（链接文本与目标均为同一 http(s) URL）或整行独立来源 URL。普通正文中的行内链接、含“剪藏”字样的长标签（如 `剪藏技巧`）、仅位于锚点笔记本中的普通笔记均不算候选。自动扫描只读属性与正文，不因发现候选写状态。
- **误报与内部文档**：用户明确标记“不是文章”时经 clip-store 写 `custom-clip-excluded=true`，后续扫描和迁移预览忽略该文档；用户显式收录时可解除此标记。插件生成的周报、数据库宿主与闪卡宿主经 clip-store 写 `custom-clip-internal=true`，旧文档按专用路径/标题回退识别。内部排除只用于未收录候选；已有有效状态的文档仍由属性次锚点展示，不因名称相似而被隐藏。
- **扫描分页与合并**：状态/来源次锚点、主锚点笔记本和 `#剪藏` 标签分别按 `updated DESC, id DESC` 分页查询，调用方必须读完所有页再合并，并按文档 ID 去重；迁移预览与索引对账使用同一合并范围。跨笔记本的 `#剪藏` 文档即使不在主锚点也能进入迁移预览。
- **导入 URL 查重**：外部文件预览与执行期均须读完状态/来源次锚点的全部分页，逐文档属性取 `custom-clip-url` 并按 §1 的比较键查重；任一分页失败即停止导入，不能把部分扫描结果当作无重复。执行期还应把本批已创建文档的 URL 放入查重集合。
- 正文启发式中只有前十行独立的官方模板 URL / 裸 URL 可作为候选证据；普通正文行内链接不得自动成为来源。
- **收录** = 首次写入全套 `custom-clip-*` 属性（status 缺省 `inbox`）。三入口：
  ①Dock 面板"新剪藏"区（锚点笔记本内无 `custom-clip-status` 的文档）；
  ②右键菜单"加入读库"（`open-menu-content`，任意文档可标记）；
  ③命令面板命令。

> v1.0.4 的查询偏差已在 S1/S2 修复；作者真机验收仍按 B-0002 跟踪。

## 3. 派生索引（saveData，可重建）

`glean-index.json`：`clips` 仅保存有有效状态的收录文档的标题、路径、笔记本及状态、URL、站点、时间、完成时间、字数、分钟、
优先级、评分、重浮日期、摘要、快照路径、AI 标签、内容类型、时间来源和文档更新时间；`candidates` 保存未收录扫描候选的
ID、标题、路径、笔记本、更新时间、可解释的来源证据（URL 属性/精确标签/官方模板/独立来源行）、来源 URL/站点与缺失项（URL、状态）；URL-only 半成品属于候选。真相永远是文档属性；索引仅是可重建缓存。候选证据与缺失项是可重建投影，不作为独立写入数据。
当前更新时机 = 插件自身经 clip-store 写属性时 + 面板打开时对账；“重建索引”命令清空后重扫。对账只有在三类范围的**全部分页成功**后，才可依据完整扫描结果移除已删除、已失去候选资格或已移出扫描范围的候选；任一页失败时必须保留旧索引并报告失败，不能以部分结果清理条目。带有效状态或 URL 的文章由全库次锚点保留，不因移出主锚点笔记本而消失。
`migrate-progress.json` 在用户确认 dry-run 后建立，逐篇写入时保存 `rows/cursor/finished`。`finished` 仅表示本轮游标到尾，失败行仍保留供显式重试；暂停不得置完成或清除进度。重新执行失败行前先重读文章属性，已写成的文档只修复索引，不重复覆盖字段。
迁移预览中的逐行“补来源 / 本地文档 / 排除”只修改待执行计划；确认开始后才写属性。运行中不接受逐行编辑，避免与保存的游标和行状态竞态。执行前按 URL 比较键复查全库，冲突行留在 `manual`，记下已有文档 ID 供用户打开；用户明确选择“仍保留第二份”才写重复来源。游标已到尾但仍有 `manual` 或可重试错误时保留任务，重开迁移器仍能处理；`finished` 不代表所有行已解决。
S2 已加入完整分页与失效候选清理；索引仍是缓存，面板对账失败时保留上次结果并报告错误。

### 3.1 S3 阅读时间线视图投影（D-0025）

`glean-index.json` 的 `clips` 条目增加两个只读投影字段：`tags` 来自文档根块 IAL 的用户标签位 `tags`，`src` 来自 `custom-clip-src`。`tags` 不是 `custom-clip-*` 属性，插件只能在扫描/对账时读取并投影，不能为了筛选把用户标签复制、改写或清空；`aiTags` 仍单独保存并且不冒充用户标签。旧索引缺字段时按空数组/空字符串兼容，重建索引从属性和 IAL 恢复。

Dock、工作台和看板把同一批索引条目映射为 `domain/library-view.ts` 的纯函数输入，共用状态、站点、用户标签、收录来源、时间来源、内容载体和关键词筛选，以及时间/更新时间/字数/优先级/评分/标题排序。筛选、分面计数和排序只返回新的视图数组，不写入文章属性，不改变五态；看板在同一筛选结果上按状态分列。候选仅在“新剪藏/inbox”视图显式包含，不能混入其他状态。

### 3.2 S3 原生编辑器阅读上下文（D-0027）

阅读上下文只在打开的文档根块有有效 `custom-clip-status` 时显示。每次编辑器加载或切换文档，以当前根块 ID 通过既有属性端点读取 `custom-clip-status`、`custom-clip-content-type`、`custom-clip-url` 和已有的 `custom-clip-words`，通过既有只读 SQL 查询根块标题；不以派生索引里的旧状态覆盖文档属性。`words` 只用于提示“已标记全文但未记录正文长度”，不据此推断载体或生成阅读进度。状态动作沿用 `clip-store`，成功后刷新上下文并通知读库视图，失败时保留原状态。来源按钮沿用 §1.1 的载体与 URL 校验，打开原文或返回读库均不写状态。

上下文条挂在思源公开编辑器事件所给的 `IProtyle.element` 内、正文之外；同一编辑器切换根块时卸载旧条，销毁编辑器时清理挂载。它不复制正文、不保存滚动或阅读百分比，也不在 `saveData` 留存上次阅读文档 ID。会话内可记住最近一篇已打开读库文章供“继续阅读”命令使用；重启后仍通过 `reading` 队列按文档 ID 返回。移动端原生编辑器挂载须作者真机验收，事件未触发时仍可从移动工作台按文档 ID 打开。

## 4. 高亮块约定（消费批注插件产出，只读不编辑）

批注插件满足任一形态即可被聚合：
①文档内块引用/引述块带 `custom-clip-highlight` 属性；
②普通引述块（`>` 块）。
V1 只做"当前文档高亮列表"侧栏（读文档子块：引述块 + 跟随批注），全库高亮墙后置。

## 5. 依赖的内核端点（v3.8.5 已验证存在，形状以 spike 为准）

| 用途 | 端点 |
|---|---|
| 属性读写 | `/api/attr/setBlockAttrs` `{id, attrs}`；`batchSetBlockAttrs` `{blockAttrs:[{id,attrs}]}`；`getBlockAttrs`；`batchGetBlockAttrs {ids}` → **响应 `{[id]:attrs}` 映射**；删除属性传 `null` 或空串（插件统一 null） |
| 查询 | `/api/query/sql`（`blocks` 表，文档=`type='d'`，`ial` 仅可 LIKE；千篇库直查 14~50ms，见 spike-report §②） |
| 语义搜索 | `/api/search/semanticSearchBlock` `{query, types:{d:true}, page, pageSize}` → `data.blocks`；**无 boxes 参数**；嵌入未启用时 code=0+空结果，**降级须先查 `embeddingStat().enabled`** |
| AI | `/api/ai/chatGPT` 请求 **`{msg: string}`**（单字符串，apicontract.AIMessageRequest）→ data 为字符串；`chatGPTWithAction {ids, action}`；`editor/lsActions`（NoBody→{id,name,action}[]）/`saveAction {id?,name,action}`/`removeAction {id}`；无模型配置时非 0 code，调用方静默降级 |
| 嵌入状态 | `/api/ai/embeddingStat` → `{total, indexed, pending, failed, ignoredByLen, ignoredByConfig, enabled}` |
| 笔记本/文档 | `notebook/lsNotebooks` `filetree/createDocWithMd`（支持 `tags` 参数，落根块 IAL） `export/exportMdContent {id} → {hPath, content}` |
| 插件装载 | `/api/petal/loadPetals`；隔离内核测试前需 `/api/setting/setBazaar {trust:true}`（桌面集市信任门槛） |
| 收集箱（后置） | `/api/inbox/getShorthands|getShorthand|removeShorthands`；事件 `open-menu-inbox` |
| 智能体 | `plugin.addAgentCapability`（注册为 `plugin/frontend/siyuan-glean/<tool>`） |
| 挂库（M2） | `/api/av/addAttributeViewBlocks` `renderAttributeView` 等（官方剪藏同款路径） |
| 闪卡（后置） | `riff/createCards` 等现有端点；V2 `registerFlashcardV2PluginType` 等内核开门后另立任务 |

以上形状全部经 M0 spike 实证（报告：`docs/spike-report.md`；原始数据：`scripts/spike/spike-results.json`）；
新端点先 spike 再进 `src/api/`。

## 6. 对外协议（预留，M5 之前不承诺稳定）

`window.siyuanGlean = { version, listClips(filter), getClip(id), setClipStatus(id, status) }`。
版本化：`window.siyuanGlean.apiVersion` 从 `1` 起；破坏性变更先升版本号并存 `docs/BRIDGE.md`（建立时）。
兄弟插件协同（打卡阅读时长、雷切工作台组件）走各自公开 API，本插件不反向依赖。
