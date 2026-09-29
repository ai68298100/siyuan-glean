# 数据契约（DATA-CONTRACT）

> 本文档是小驴拾遗"生产数据边界"的唯一事实源。改任何一条存储/字段约定，先改这里。
> 全部端点形状经 M0 spike 在思源 v3.8.5 真内核实证（`scripts/spike/`，报告见 `docs/spike-report.md`）。

## 0. 数据主权划分

| 数据 | 存放位置 | 插件卸载后 |
|---|---|---|
| 文章状态（五态/评分/优先级/摘要/AI标签/重浮记录） | 文档属性（根块 IAL，`custom-clip-*`） | **仍在**（思源内核数据） |
| 用户自己的标签 | 根块 IAL `tags`（官方剪藏写入位） | 仍在，插件永不触碰 |
| 派生索引 `glean-index.json` | 插件 saveData | 随插件删除，可随时重建 |
| 插件设置 | 插件 saveData | 随插件删除 |

## 1. 属性规范（文档级，根块 IAL）

`src/domain/schema.ts` 为唯一事实源；本表与其同步维护。

| 属性 | 类型 | 说明 |
|---|---|---|
| `custom-clip-url` | string | 来源 URL（收录时尽量回填；迁移启发式或手填） |
| `custom-clip-site` | string | 站点名（可空） |
| `custom-clip-time` | string | 入库时间 `YYYYMMDDHHmmss`（思源时间格式） |
| `custom-clip-status` | enum | `inbox` / `later` / `reading` / `done` / `archived`（D-0003 五态） |
| `custom-clip-words` | number | 正文字数 |
| `custom-clip-minutes` | number | 预计阅读分钟 = round(words/400) |
| `custom-clip-priority` | number 1-5 | 手动优先级（重浮加权用，默认 3，用户手填字段） |
| `custom-clip-rating` | number 0-5 | 读后评分（可选，用户手填字段） |
| `custom-clip-ai-tags` | string | AI 标签（逗号分割，与用户 `tags` 完全隔离，永不覆盖用户 tags） |
| `custom-clip-summary` | string | AI 一句话摘要 |
| `custom-clip-last-surfaced` | string | 最近一次被重浮的日期 `YYYYMMDD` |
| `custom-clip-snapshot` | string | 单文件 HTML 快照的 assets 路径（T-1504，防内容/链接腐烂） |
| `custom-clip-src` | string | 来源管道：`web-clipper`/`inbox`/`manual`/`migration`/`import-*` |

写入规则：

1. 统一经 `services/clip-store.ts`（T-1100）读写，带 schema 校验与幂等；其余代码不得裸调 attr 端点写这些键。
2. 删除属性传 `null`（内核语义）。
3. 数字属性以字符串形态存入 IAL（内核 IAL 值均为字符串），读取时按 schema 还原类型。
4. 用户手填字段（`custom-clip-url` 已有值 / `custom-clip-status` / `custom-clip-priority` / `custom-clip-rating`）AI 富化与迁移器一律不覆盖；AI 只写 `custom-clip-ai-tags` / `custom-clip-summary`。
5. 迁移幂等：已带 `custom-clip-url` 的文档整体跳过，不重写时间戳。

## 2. 文章识别：双锚点

- **主锚点**：设置中指定的"读库笔记本"（可多个，存 `anchorNotebooks`）。
- **次锚点**：任意笔记本中带 `custom-clip-url` 的文档（SQL `ial LIKE '%custom-clip-url%'` 圈定，属性精确值走 attr 端点读）。
- **辅助标签扫描**：当前版本还扫描任意笔记本带 `#剪藏` 标签的文档，作为未收录候选来源（v1.0.3 已实现）；标签名目前固定为“剪藏”。它只扩大扫描范围，不表示该文档已被收录。候选资格与误报处理按 T-1706 重整。
- 正文启发式（首行 `- [url](url)` 链接行、正文 `<cite>` 残片）只用于迁移器回填提取 URL。
- **收录** = 首次写入全套 `custom-clip-*` 属性（status 缺省 `inbox`）。三入口：
  ①Dock 面板"新剪藏"区（锚点笔记本内无 `custom-clip-status` 的文档）；
  ②右键菜单"加入读库"（`open-menu-content`，任意文档可标记）；
  ③命令面板命令。

> v1.0.4 实现偏差：`listClipDocs()` 只按 `custom-clip-status` 搜索，未覆盖本节 URL-only 次锚点；锚点笔记本查询还缺少 SQL 字符串引号。均列入 T-1701/T-1706，不能把当前面板结果视为完整扫描。

## 3. 派生索引（saveData，可重建）

`glean-index.json`：`clips` 保存收录文档的标题、路径、笔记本及状态、URL、站点、时间、字数、分钟、
优先级、评分、重浮日期、摘要、快照路径、AI 标签和文档更新时间；`candidates` 保存未收录扫描候选的
ID、标题、路径、笔记本与更新时间。真相永远是文档属性；索引仅是可重建缓存。
当前更新时机 = 插件自身经 clip-store 写属性时 + 面板打开时对账；“重建索引”命令清空后重扫。
v1.0.4 的查询有数量上限，尚无完整分页与失效候选清理，列入 T-1706；不能把索引视为全库无遗漏的真相。

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
