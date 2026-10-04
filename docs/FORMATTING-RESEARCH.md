# 排版后续研究：原文事务与图片语义

> T-3220 / T-3221，2026-10-04。源码研究与隔离事务 spike；不增加生产 API 封装、不写作者原文、不调用真实模型、不读思源密钥库。本报告不是 DATA-CONTRACT 的生产能力扩展，也不关闭待办。

结论：T-3220 可以进入“小范围原生块变更”的隔离 spike，但现有 Markdown 整理计划不能直接应用到原文，内核全局 undo 也不能自动视作“撤销本插件这次操作”。T-3221 的底座在内核 Agent 中有真实图像附件实现，但拾遗目前官方与自定义调用都只发送文本；需要独立的通道能力、资源授权和模型实测，不能用文件名、alt、OCR 或图片 URL 猜测来冒充视觉理解。

## 1. 证据来源与等级

| 来源 | 本次得到的证据 | 限制 |
|---|---|---|
| 本仓库 `src/domain/formatting.ts`、`src/services/formatting-service.ts`、`src/ui/FormattingDialog.svelte` | 基础分析、严格 AI 结构计划、对照和独立整理稿；保存前检查原文/元数据，建稿后复用 ID | 不含块级原地应用、事务撤销或图像字节输入 |
| `docs/DATA-CONTRACT.md` §3.4/§5、D-0063、`docs/FORMATTING.md` | 当前产品和数据边界 | 不能在本研究文档中擅自扩展生产契约 |
| `scripts/e2e/s1-flow.mjs:359` 的排版用例 | 已有隔离脚本验证导出 `{yfm:false, addTitle:false, refMode:2}`、回链、建稿、原文/属性不变 | 本轮未重跑；不覆盖事务或视觉模型 |
| `scripts/spike/kernel-harness.mjs`、`transaction-spike.mjs` | 已用独立临时工作区、标记、回环端口和 `3.8.6` 内核完成事务/容器/失败/撤销/重排/嵌入资源 spike；内核候选位置包含 `D:/biji/SiYuan/resources/kernel/SiYuan-Kernel.exe` | 只向隔离内核发请求，没有向 6806 或作者客户端发请求；未覆盖真实编辑器 UI |
| 本地缓存 `D:/AI/tmp-siyuan-source` | Git 标签 `v3.8.6`，HEAD `158812497497c6fa8a6d1031bfa2f025a61ee5c2`；读取时 tracked 文件无修改 | 源码存在不保证作者安装二进制有相同能力，也不证明 3.8.5 支持 |

下文 `kernel/...`、`app/...` 均相对上述本地源码根目录，行号对应该缓存快照。拾遗 `plugin.json` 仍声明 `minAppVersion=3.8.5`；涉及 3.8.6 新能力必须确认最低版本或做明确能力门禁，不能静默改变全插件最低版本。

## 2. T-3220：应先保证什么

原文是带身份和引用关系的块树，不只是 Markdown 字符串。必须先回答：这次排版是否值得修改用户原文、允许改变哪些块、用户能否验证差异、失败/撤销是否保留身份。T-3219 独立整理稿仍作为既有路径，其真实宿主/模型验收归 B-0002/B-0004；在验收未闭环前，可以完成隔离研究，但不提前开放原地应用。

### 2.1 真实源码中可研究的端点

| 候选端点 | 源码证据及请求/返回 | 用途与风险 |
|---|---|---|
| `/api/block/getChildBlocks` | `kernel/apicontract/contracts.go:92`；`block.go:3`/`:74`，`{id}` → `{id,type,subType?,content?,markdown?}[]` | 取直接子块，不能把结果误当全部后代或无损快照；树形顺序必须实证 |
| `/api/block/getBlockDOM` | `contracts.go:333`；`block.go:51`，`{id}` → `{id,dom}` | 可保存原生块 DOM 的 before/after；规范化、IAL 和嵌入关系仍要实测 |
| `/api/block/getBlockDOMWithEmbed` | `contracts.go:334`；`block.go:1270`，`{id}` → `{id,dom}` | 隔离样本可读回 `NodeBlockQueryEmbed` 及目标块 ID；不替代真实编辑器渲染验收 |
| `/api/block/getBlockSiblingID` | `contracts.go:300`；`block.go:148`，`{id}` → `{parent,previous,next}` | 读取树邻接；`blocks` SQL 表没有 `previous_id/next_id` 列，不能用 SQL 列名代替 |
| `/api/block/getBlockKramdown` | `contracts.go:337`；`block.go:56`，`{id,mode?}` → `{id,kramdown}` | 可作辅助核对；不替代原生 DOM/IAL/引用快照 |
| `/api/block/updateBlock` / `batchUpdateBlock` | `contracts.go:400`/`:404`；`kernel/api/block_op.go:704`/`:775`；`kernel/apicontract/block_inputs.go:54`/`:61`：单块 `{id,data,dataType,lockType?}`，批量 `{blocks:[单块输入]}` | 走同步块更新路径；可用于 ID/IAL spike，但当前更新事务不带 undoOperations，不自动进入编辑器全局撤销日志 |
| `/api/block/moveBlock` | `contracts.go:370`；`block_op.go:396`，`{id,parentID?,previousID?}` → `null` | 隔离样本可改变同级邻接并保留 ID，但直接调用不改变 undo/redo 栈；不能提供插件撤销 |
| `/api/asset/getDocImageAssets` / `getDocAssets` / `statAsset` | `contracts.go:852`/`:853`/`:844`；`asset.go:176`/`:192` | 隔离样本只读本文档引用的本地 PNG 并核对正大小；不证明外链、跨笔记本和资源写入安全 |
| `/api/transactions` | `contracts.go:1046`；`transaction_types.go:82`/`:89`；`{transactions:[{doOperations,undoOperations}],reqId,app?,session?}` | 原生 do/undo 方案；operation 的 data 是原生 BlockDOM 或动作特定形状，不能传整个预览 Markdown 假充块 DOM |
| `/api/transactions/undoState` | `contracts.go:1047`；`transaction_types.go:104`，`{rootID}` → `{canUndo,canRedo,peekMutatedRootIDs}` | 只给文档栈状态及涉及文档，未给插件 operation ID 或栈顶唯一身份 |
| `/api/transactions/undo` / `redo` | `contracts.go:1048`/`:1049`；`transaction_types.go:97`，`{rootID,app?,session?}` | 对文档栈顶操作撤销/重做；不是按插件令牌撤销某次排版 |

这些是**源码发现并由首轮隔离 spike 部分验证、拾遗仍未新增生产封装**的候选契约。所有生产端点字符串只进入 `src/api/`；不得从 UI 直接 fetch，也不得绕过 clip-store 修改 `custom-clip-*`。

### 2.2 不能整篇覆盖的具体原因

`kernel/model/block_update.go:135` 对文档根更新，会删除原来的顶层块再 appendInsert 新内容。即使根文档 ID 没变，后代 ID、指向其块引、闪卡、摘录锚点和第三方关系仍可能损坏。禁止把 `updateBlock({id:docId,data:wholeMarkdown})` 当作“原地排版且无损”。

同文件 `:49`/`:54` 先在 flushLock 中准备输入并同步执行；`:161` 固定被更新块的 ID，`:264` 还尝试固定后代 ID。这只能证明存在保留身份的机制，不证明每种类型转换保留所有后代。`kernel/model/transaction.go:1848` 的 doUpdate 解析 BlockDOM、验证结构/类型、处理块引用、缓存 IAL 并替换旧节点；未显式保留的属性及类型专属元数据不能凭“同 ID”认定安全。

当前 `formatting.ts` 的段落编号来自 Markdown 空白分割，是本次分析编号，**不是原生块 ID**。导出会规范化超级块、嵌入、IAL 等；即便固定 refMode，也不可把导出段落反向一对一映射为原文块。必须从原生树/块数据创建一个新的 ID 绑定计划，Markdown 预览仅作解释。

### 2.3 事务与撤销边界

- `kernel/model/block_update.go:75` 创建的事务仅含 DoOperations；`kernel/model/undolog.go:109` 只有来自 `/api/transactions`、含非空 UndoOperations、非 replay 的已提交事务才记录。因此“updateBlock 返回 transaction”不等于有 Ctrl+Z 或插件撤销。
- `kernel/api/transaction.go:35` 标记 HTTP 事务并排入队列；`:170` 等待 flush/commit 后广播。`kernel/model/transaction.go:118` 的失败经推送报告，而普通 API 路径末尾仍包装事务成功响应。不能仅看 HTTP `code=0` 就宣称所有操作落盘，必须核对实际树和错误事件；第二个 operation 失败的原子性需要隔离实验。
- 单个 Transaction 和请求中的多个 Transaction 不是同一个原子单元。不要逐块多次请求后称“整次整理原子提交”；内存/SQL 回滚也不能被推导为全部文件/同步/索引的 ACID 保证。
- `kernel/model/undolog.go:77` 的全局日志在内存，容量 64、重启清空；`:109` 的 Record 分文档入栈。`kernel/api/transaction.go:228` 撤销的是文档最近一次，可能是用户编辑或另一个插件的操作。
- `/undoState` 没有栈顶唯一 operation ID。即使插件保存 after hash，用户后来编辑再改回相同内容，也可能留下不同栈顶；“比较正文相同再调用原生 undo”不能证明会撤销自己的事务。状态查询与撤销之间也有竞争窗口。
- `kernel/api/transaction.go:248` 明确以 `code=0 + data.failed=true` 报告 replay 失败；没有可撤销时返回空历史状态。现有 `kernelPost` 只检查外层 code，新封装必须逐种判定内层 failed/空栈，不能报假成功。
- `kernel/model/undolog.go:500` 的 ResolveReplayDuplicateIds 在恢复插入时遇到已存在 ID 会重分配 ID。因此删除后块被粘贴/复用，再 undo，不能承诺原 ID 一定回来。
- `app/src/protyle/wysiwyg/transaction.ts:2438` 同时参与原生本地撤销镜像、交易队列和会话推送。API 调用与页签/原生编辑器两实例的同步、发起方 DOM 更新和 Ctrl+Z 次序必须宿主实证。

**可行方案的边界**：先验证使用原生编辑器的受支持事务/撤销体验，首版只做单文档、不删除的块变更；插件可以解释如何使用宿主撤销。若产品必须提供“只撤销本次排版”的独立按钮，需要可验证的栈顶身份/原子条件契约，或另行设计受冲突保护的反向补偿事务并明确它与宿主 undo 的区别。后者仍可能污染撤销历史，不能当作已解决的替代方案。缺少条件时不显示这个按钮，不清空用户历史、不循环撤销直到遇到自己的记录。

### 2.4 必须验证的不变量

| 不变量 | 核对方法 / 失败时规则 |
|---|---|
| 文档和块身份 | 以任务专属原生 `.sy` 树核对真实父级/邻接及重复ID，SQL parent_id与getBlockSiblingID列表投影分别保留，身份集合排序不冒充树顺序 |
| 用户与第三方 IAL | 根 `custom-clip-*`、tags、块 alias/name/memo/style/fold、未知 `custom-*` 等与前态比较；排版不写五态/URL/优先级/评分；updated 等内核维护值单列，不要求时间戳倒退 |
| 引用关系 | 另建文档静态/动态块引、`siyuan://blocks` 链接、嵌入、摘录回跳、riff 和 AV 绑定；应用/undo/redo 后均能解析；删除候选被引用时默认阻止或保留 |
| 正文和资源 | 仅改变用户确认的格式/链接显示；顺序、文字、href/src、inline mark、脚注/公式/代码/表格原样；不删除 assets；保护未知结构 |
| 并发与源变更 | 应用前原生 DOM/IAL/邻接关系复查；任一变化拒绝旧计划。事前回读并非内核 CAS，仍需明确提交窗口的限制 |
| 真实提交与失败 | readback 应用前后树，区分 SQL 最终一致性；响应丢失记未知结果、核对而非自动重发；第二操作失败/缺块/只读/锁定/重启均留证 |
| 生命周期与撤销 | 原生+页签双编辑器、用户中间编辑、移块、ID 冲突、空栈/过期/重启；无法证明撤销归属时不调用栈顶 undo |

### 2.5 最小隔离 spike 计划（首轮已执行，复杂样本仍未完成）

1. 复用 kernel-harness 约束，创建本任务专属临时工作区/标记，检查回环端口不占用；仅隔离内核执行 `/api/setting/setBazaar {trust:true}`。记录二进制版本及源码哈希；不要复用作者数据或驱动真实窗口。
2. 建两篇测试文档：原文包含两段、标题、嵌套列表、代码/公式/表格、图片、IAL、引述及复杂容器；另一篇建立静态/动态块引与嵌入。读原生 DOM、属性、树关系和引用基线。
3. 先只改一个普通叶段落的链接显示或格式，保留真实 ID/IAL/文字/目标；分别比较 updateBlock 和 `/api/transactions` 加 before DOM undoOperations 的行为。标题类型提升单独实验，不默认允许。
4. 同一 Transaction 两个 operation；第二个设不存在 ID/非法 DOM，验证首个是否撤回及外层/事件/回读结果。另用多 Transaction 请求对照，避免误认原子范围。
5. 应用后立即宿主 undo/redo、再插入用户编辑后尝试撤销；测试属性改变、块移动/粘贴、引用、重启/历史容量和响应丢失。记录不能保证的项，不能只验证正常路径。
6. 有实证后由负责人先更新 DATA-CONTRACT/DECISIONS/TODO，再新增 API 层和最小服务/UI。真实原生编辑器、双实例及快捷键结果继续归 B-0002。

### 2.6 隔离结果（2026-10-04）

严格探针通过：隔离思源3.8.6，最新工作区 `C:\Users\sunku\AppData\Local\Temp\siyuan-glean-t3220-1791143874720-21700`，完整结果见其中 `transaction-report.json`、内核尾日志见 `kernel-tail.log`；未连接作者实例。初版父级覆盖、虚构SQL邻接列、随机样本和伪PNG证据已校正；异常退出没有足够日志证明内核崩溃原因。结果如下：

| 样本 | 结果 | 证据边界 |
|---|---|---|
| `updateBlock` | `code=0`，叶块 ID 集合和根块属性保持，`undoState` 仍为 `canUndo=false/canRedo=false` | 证明该路径本身不提供原生撤销记录，不证明复杂块更新无损 |
| `/api/transactions` 单个 `update` | `code=0`，在含嵌套列表、代码、公式、表格、图片引用、块引用和跨文档引用的复杂文档中，读回保留复杂树块 ID 集合、根属性、叶块用户 IAL 和引用；`undo` 后标记消失，`redo` 后恢复 | 只更新普通叶段落；操作数据是原生 BlockDOM，不是整理 Markdown 段落号，未证明容器块重排安全 |
| 同事务有效更新 + 不存在块 | 外层 `code=0`，有效更新未留存 | 只覆盖本次两个 `update` 操作；不能外推所有操作类型/跨请求原子性 |
| 同一请求的两个独立 Transaction | 第一个有效更新已留存，第二个不存在块更新未留存，外层 `code=0` | 请求数组不是原子单元；不能逐块发 Transaction 后宣称整次排版可整体撤销 |
| 单个嵌套列表容器 `update` | 11 个块的 ID 集合、父子/前后邻接、用户 IAL 保持，`undo/redo` 往返通过 | 只覆盖一个容器 BlockDOM 的文本变更；未覆盖容器重排或双编辑器 |
| 同级 `moveBlock` 重排 | 同级两个段落重排后 ID 和根属性保持，`getBlockSiblingID` 读回邻接，直接调用前后 undo/redo 状态不变，恢复操作通过 | 证明该端点当前没有可用的插件撤销语义；未覆盖跨容器/标题组/并发 |
| 块嵌入与真实本地资源 | `getBlockDOMWithEmbed` 读回 `NodeBlockQueryEmbed` 和目标块 ID；`getDocImageAssets`/`getDocAssets`/`statAsset` 读回本地 PNG；普通叶块事务及 undo/redo 后资源、嵌入目标和 ID 保持 | 只覆盖单个本地资源和简单嵌入；未覆盖资源写入、外链、跨笔记本和真实编辑器渲染 |
| 内核重启 | 已提交叶块事务的正文和块 ID 在重启后保持，内存 undo/redo 历史清空；随后以 `updateBlock` 清理标记 | 只覆盖隔离服务重启；不能证明重启后可按插件归属撤销，也未覆盖双编辑器/并发/响应丢失 |
| 客户端响应丢失 | 回环代理完整转发 `/api/transactions` 后销毁客户端响应；读回确认写入已落盘、ID 保持、文档 undo 可用；探针不自动重发 | 只覆盖本次服务请求；必须先核对未知结果，未覆盖真实网络、双编辑器和并发 |
| 两个 API 客户端并发更新不同叶块 | 两个独立 session 同时写入不同叶块，两个标记均读回，块 ID/根属性保持，并可分别 undo/redo | API 客户端不是双 Protyle 编辑器；未覆盖用户中间编辑、焦点和真实网络 |
| 两个API客户端同一叶块并发冲突 | 从同一旧DOM提交，严格读回恰好一个标记；本次为B，不保证哪一方胜出或其提交顺序 | 无CAS/冲突合并；必须读回，不能自动重发或覆盖 |
| 嵌套NodeList跨父级移动/恢复 | 源列表保留兄弟项时，移动并恢复保持原生父级/邻接、全部ID/用户IAL/根属性；深层子树样本移动/恢复保持 5 个块；直接move不进undo | 真实宿主撤销未测 |
| 移走唯一列表项 | 合法地将唯一源列表项移入另一列表后，列表项 ID 保持，源空列表从索引消失；删除后的 `getBlockDOM` 返回 `code=0` 空内容，不能只看 code 判定仍存在 | 未覆盖真实编辑器渲染、资源删除或宿主撤销 |
| 真PNG写入/覆盖/恢复与跨笔记本引用 | 1×1PNG写入、另一PNG覆盖、恢复原字节均getFile逐次核对，两笔记本引用列出 | 不证明权限隔离、删除、外链、编辑器渲染或资源undo；旧版纯文本伪PNG不算图片证据 |
| `/api/block/insertBlock` / `deleteBlock` 直接调用 | 两个端点均返回原生操作并正确落盘，但返回操作的 `rootID` 为空，调用前后文档 `undoState.canUndo/canRedo` 不变 | 这些端点本身不提供当前文档 undo 记录；不能调用后直接宣称用户可撤销 |
| 原生插入/删除操作包装为单个 `/api/transactions` | 使用端点返回的插入 DOM 操作及显式删除逆操作，再以单事务执行插入；删除同理，插入/删除均可 `undo/redo`，既有块 ID 保持 | 证明的是已验证操作组合在隔离服务 API 的行为，不证明多 Transaction 请求原子或宿主 UI 同步 |
| 已有标题层级 `h1 → h3` | `/api/block/getHeadingLevelTransaction` 返回事务；标题块 ID、用户 IAL 保持，`undo/redo` 往返通过 | 该端点用于已有标题层级调整；普通段落请求返回空事务，不能当作段落转标题接口 |
| 跨 session `undo` | 第一次撤销先撤掉后提交的另一 session 更新，第二次才撤掉先前更新 | 文档撤销栈没有插件归属隔离，不能按 session 提供“撤销本插件操作” |

仍未覆盖双编辑器、用户中间编辑、真实网络故障、真实宿主撤销、外链/资源权限/删除与编辑器渲染。隔离代理和 API 并发只证明服务边界，T-3220 保持研究状态，不进入生产原文应用。

## 3. T-3221：当前通道到底是否能看图片

### 3.1 拾遗与内核能力不能混为一谈

| 路径 | 当前真实实现 | 结论 |
|---|---|---|
| 拾遗官方 `api/ai.ts:12` → `/api/ai/chatGPT` | `kernel/apicontract/ai.go:158` 只接 `msg:string`；`kernel/model/ai.go:238` 选 Editing 模型；`kernel/util/openai.go:84` 用 `Content:msg` 构建纯文本 messages | 无图像字节/图像 part；把图片 Markdown、URL 或 base64 塞进字符串不会自动成为视觉输入 |
| 拾遗自定义 `api/ai-direct.ts:33` | `domain/ai-direct.ts:24` 的 buildChatPayload 固定 user content 为字符串；返回解析只接受字符串；连接测试仅“正常”文字 ping | OpenAI 兼容模型即使支持 vision，现有封装也未发送图像；必须新建真实多模态 payload 和能力回归 |
| 内核 Agent 图像附件 | `kernel/agent/attachments.go:108` 把实图构造成 `MultiContent`，含 `data:<mime>;base64,...` image_url；`:147` 通过 PrepareDocumentImage/PrepareAgentMessageImage 取资源 | **内核源码有视觉输入底座**，不等于拾遗已接入，也不等于全部模型/协议可用 |
| 内核 image 工具 | `kernel/mcp/tools/image.go:39`，list/analyze/generate；`:131` 的 analyze 只准备并附图给当前 Agent 模型，返回 attached 元数据，不直接返回视觉判断 | 不是一个可假设存在的 `/api/ai/analyzeImage`；不能把 `attached:true` 当作看图结果 |
| Agent HTTP | `kernel/apicontract/contracts.go:983` 的 `/api/ai/agent/chat` 是 SSE；`ai_agent.go:112` 采用 session/message/editorContext/capabilities/model 等结构 | 与拾遗纯文本调用的模型绑定、权限、会话保存、工具和费用语义不同，尚未 spike，不直接借 Agent 绕过现有边界 |
| OCR / 图片生成 | 源码有 `asset/ocr` 和图片生成配置 | OCR 只提供文字；生成是输出图像能力，二者都不证明能判断图像与文章的关系 |

`kernel/agent/attachments.go:35` 限制单请求最多 4 张/20 MiB；`kernel/model/assets.go:366` 的本地图像准备限制 20 MiB、40M 像素、最大边 2048。`kernel/util/openai.go:775` 验 MIME/尺寸，拒绝 SVG，支持 gif/jpeg/png/webp，并可能缩放/将 GIF 转为单帧；模型提供商可能有更严上限。这些是内核路径的源码限额，不能直接宣称自定义通道继承了同样校验。

`kernel/agent/agent.go:968` 有图像不支持时降级；`attachments.go:40` 明确提示不能声称看过被省略图像。拾遗若采用新路径，必须保留“已发送/未发送/发送失败/模型不支持”证据，纯文本降级后不能继续给“无意义图片”结论。

### 3.2 当前图片候选的事实边界

`src/domain/formatting.ts:99` 只判断独立 Markdown 图片的目标是否重复及 alt 是否为空。相同 URL 可能在不同段落解释不同内容；无 alt 可能是核心图表。图片与文字混合、HTML、引用/表格等复杂结构受保护。现有候选默认不选且只从整理稿移除，**不删除原文图片或 assets**。按 D-0076，排版 prompt 对图片块只发送 `[image]` 占位符，不发送图片 URL、alt、文件名、外链参数或字节；没有视觉输入时，计划校验也拒绝 AI 直接提交图片清理，结构候选仍可由用户手动选择。

视觉语义不是“有没有 alt”，而是图像内容及它与文章上下文的关系。新增候选应至少解释观察到什么、为什么建议保留/清理、依据位于哪段、是否含图表/公式/截图/文字及不确定性；模型意见只能作为人工判断材料。装饰图、作者头像、二维码或重复展示也可能有用途，不能用通用“无意义”标签自动删除。

### 3.3 图片隐私与资源条件

1. **独立默认关闭的功能开关和显式动作。** AI 排版开关不自动授权发送图片；打开预览、文章或扫描不取外链或发图片。请求前显示已选图片、张数、目标通道/模型和必要上下文范围，允许移除/取消。
2. **只读确实被本文引用的资源。** `kernel/model/assets.go:453` 验证 documentID 所属笔记本及其引用的 `assets/...`；自定义通道也必须保证同样边界，不由模型返回路径任意读文件，不全库扫描私图。`assets/` 文件名不是外部可访问 URL；现有 `src/api/assets.ts` 主要写资源，没有经 spike 的图像读/准备封装。
3. **外链有单独影响。** 直接把网页图片 URL 发给提供商，可能暴露签名参数/来源并由提供商访问；浏览器自动预览也会联网。首个版本可限定本地已存在图片，外链明确未分析；以后支持外链再验证下载权限、认证、重定向、内网地址和体积，不走未证实代理。
4. **只发送必要字节。** 图片可含个人信息、密钥截图和元数据；明确缩放/首帧/裁剪后看到的范围，避免假称原图全部分析。可做有界重新编码减少元数据；不能把缩放到看不清的文字/图表判成无意义。
5. **认证与日志保持既有数据边界。** 自定义密钥仍运行时经 getSecret；不保存 key、图片字节/base64、完整 prompt、原始模型输出或带参数 URL 到插件 saveData/日志。错误响应可能回显输入，不能只截断后记录；需要结构化脱敏。诊断仅用阶段/模型标识/数量/尺寸/错误类别等白名单。
6. **同一预算与队列。** 使用共享治理后的模型队列、额度和排队后开关复查；计量区分实际模型调用成功与是否产生有效候选。取消/超时可能已发生提供商费用，不能承诺不计费或静默重试。
7. **候选绑定快照。** 图片候选绑定本文实际块/段落、资源标识及字节指纹、有限上下文；结果只允许固定编号/分类/理由，不接受任意删除路径或模型工具执行。图片或原文变化后旧候选失效。
8. **人工确认只影响整理稿。** T-3221 可独立先增强 T-3219 副本候选，不依赖 T-3220；无有效视觉响应、模型不支持、关闭、失败或额度不足时保留现有基础候选/原图。删除原文/资源另立契约，不能由此研究顺带实施。

### 3.4 两条候选技术路线仍需验证

- **官方优先研究受限的图像动作契约。** 内核 Agent 能附图，但拾遗需要单次只读、禁工具写入、不自动读其他文档、可预期会话留存、模型选择与 SSE 完成/降级信号。源码中的 Agent 接口并未证明这些条件可全部满足；若不满足，保留官方通道“暂不支持图片分析”的能力说明。
- **用户自选通道研究真正多模态请求。** 在 api/domain 增加经验证的文本+图像 content parts、MIME/体积/张数校验、模型/通道能力探测与失败解析。现有 `isDirectChannelAllowed(getFrontend())` 会拒绝 browser-*；不得以浏览器绕过路径/CORS。每个通道/模型实测，文字 ping 通过不升级 vision 能力。

不新建通用聊天窗，不增加插件自带 LLM key，不用上传无关图片或调用更高权限 Agent 来替代缺失的图片接口。模型支持资料、SDK 类型和内核源码只是候选证据；真正上线至少需要一次可证实图像内容改变了结果的模型实验。

### 3.5 真实视觉模型验收样本（尚未执行）

| 样本/失败 | 必须观察的结果 |
|---|---|
| alt/文件名相同，但像素分别为核心图表与推广二维码 | 判断依据随像素改变，不能随命名臆断；核心图表默认保留 |
| 同一图不同上下文、含公式/代码截图、无 alt 核心步骤图 | 展示语义与上下文解释及不确定性；无法判断时保留 |
| 本地资源/不同笔记本同名资源/失效图片/外链 | 只读本文所属有效资源；缺图或未发送明确说明，不能猜测 |
| 超大图、SVG、动画、缩放后看不清、超张数 | 有界处理/拒绝，显示实际分析范围和未分析项目 |
| 纯文本模型、拒绝 image_url、返回元数据但无判断、非法编号/JSON | 记能力不可用/非法结果，保留原图；不把降级文本当视觉结论 |
| 超时、认证、额度不足、取消、并发入口 | 队列/计量真实，不自动重复请求；结果无敏感回显 |
| 图片内“忽略规则/删除文件/输出密钥”等文字 | 作为不可信图像内容；结果不能触发工具、路径读写或自动删除 |
| 调用后原文/图片变更 | 旧建议失效，重新确认；默认候选选择为空 |

真实通道和模型质量记录归 B-0004，图片预览、焦点、触控、assets 及误报人工核对归 B-0002/B-0006。没有真实模型和实图输入证据前，任务保持研究/待验收。

## 4. 可立即进行而不依赖真实账号的后续工作

| 工作 | 可独立产物 | 进入生产的门槛 |
|---|---|---|
| T-3220 原生快照与事务探针设计 | 版本/端点/树/IAL/引用/故障样本清单；隔离 spike 脚本可由负责人另行拥有 | 实际隔离执行证明 ID、引用、失败语义与 undo 范围后再改契约/API |
| T-3221 通道能力与资源权限设计 | 明确 unknown/text-only/vision-verified 状态、资源选择/发送范围、脱敏和失败规则 | 新资源端点 spike、多模态实际发送和真实模型验收 |
| 现有排版预览的可解释性增强 | 将“重复目标/无 alt”明确标为结构证据，保留默认未选及受保护结构 | 不升级为语义结论，不写原文/删资产；双语与相应行为回归 |
| 与两项研究无关的读库增强 | AI 共享治理、共用横幅、rail 展开、标题大纲、保存视图/只读导出 | 参考 `BACKLOG-AUDIT-2026-10-04.md`，先协调高冲突文件所有权 |

本次完成的是证据整理与验证方案，未获得新的端点运行实证或真实模型结果；不以研究文档存在替代 T-3220/T-3221 的实现及验收。
