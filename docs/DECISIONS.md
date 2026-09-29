# 架构决策记录（DECISIONS）

每条决策带编号、日期与动机；重大翻转需新增条目而非修改旧条目。
编号从 D-000 起；D-0001~D-0006 为规划书定案落账（作者 2026-09-29 拍板）。

## D-0001（2026-09-29）属性规范定案：文章状态全部写入文档属性（根块 IAL）

一切文章状态（状态机/评分/摘要/重浮记录）写入 `custom-clip-*` 文档属性——思源内核数据。
插件自身 saveData 只存派生索引（`glean-index.json`）与设置，均可随时重建。
铁律三条：①属性一旦写入，永不因插件卸载而丢失；②迁移幂等（已有 `custom-clip-url` 的文档跳过）；
③用户手填字段（url/status/priority/rating）AI 与迁移器都不得覆盖。
完整字段表见 `docs/DATA-CONTRACT.md` §1；改动需新决策 + 迁移脚本。

## D-0002（2026-09-29）文章识别走双锚点：主锚点=读库笔记本，次锚点=`custom-clip-url` 属性

正文启发式（首行链接匹配）只允许用于迁移器回填时提取 URL，**不得**作为剪藏唯一判定。
收录入口三件套：面板"新剪藏"区 / 右键菜单"加入读库" / 命令面板命令。见 DATA-CONTRACT §2。

## D-0003（2026-09-29）状态机五态：inbox / later / reading / done / archived

对应收件池→稍后读→阅读中→已读→归档的完整生命周期。五态即看板五列（M2），
重浮只从 `inbox/later`（+可选 done 高亮）取材（M4）。属性值为小写枚举字符串，扩展新态需新决策。

## D-0004（2026-09-29）AI 全部走思源官方通道，插件不自带 LLM API key

一律经 `/api/ai/chatGPT`、`chatGPTWithAction`、`editor/chat`、`semanticSearchBlock`，
使用用户已配置的模型。插件零密钥、零订阅、零额外付费。AI 功能逐功能开关、默认关闭；
失败静默降级并记 BLOCKERS，绝不打断收录主流程。

## D-0005（2026-09-29）版本语义化：从 v0.1.0 起步，每里程碑发一版

不跳号、不用大版本号伪装成熟（打卡 18.x 是反面教材）。minAppVersion=3.8.5；
V2 闪卡相关功能要求 3.8.6+，相关任务后置到内核功能落地后另立任务。
打 tag / 发 Release / 提交集市由作者逐次确认；集市 PR 未获授权前不做。

## D-0006（2026-09-29）名称定案：小驴拾遗 / Lv Glean / 仓库 siyuan-glean

作者 2026-09-29 拍板落账。中文「小驴拾遗」，英文「Lv Glean」，仓库 `siyuan-glean`，
对外协议 `window.siyuanGlean`（版本化，M5 之前不承诺稳定）。
品牌叙事：「小驴拾遗，把吃灰的收藏捡回来喂给自己」；UI 文案保持克制直白。

## D-0007（2026-09-29）AI 是一等公民，贯穿全部功能面（作者指示）

作者明确要求"充分拥抱 AI，各功能尽量多给 AI 空间"。落地口径：
①收录即富化（摘要/AI标签/查重）是默认推荐路径（可一键全关）；
②阅读侧栏给 AI 动作常驻位（总结/要点/反方观点/自定义 prompt）；
③关联推荐、每周摘要、重浮理由都用 AI 生成一句话说明；
④智能体工具（addAgentCapability）M3 起随版本扩充；
⑤后续新功能设计时必须回答"AI 在这里能做什么"，至少预留动作钩子。
约束仍遵守 D-0004：走官方通道、可全关、静默降级。

## D-0008（2026-09-29）「不做清单」是延后而非永久（作者指示）

规划书 §1 的竞合边界与 §9 禁止事项按作者 2026-09-29 指示重新定调：
①数据主权、契约先行、不自带 key、不覆盖用户手填字段等工程红线**不变**；
②"不做阅读调度/不做批注 UI/不做通用聊天窗"降级为**延后项**——先做管理端主线，
预留"推入渐进阅读"等集成动作，若作者后续要求，按新决策启动，不在规划里咬死不开发；
③批注消费协议（DATA-CONTRACT §4）保持开放，任何满足形态的批注插件产出都能被聚合。

## D-0009（2026-09-29）仓库结构：插件工程直接位于仓库根

对齐小驴打卡/小驴雷切的布局（plugin.json 在仓库根），不做人脉那样的子目录嵌套。
仓库 `siyuan-glean` ↔ 工作目录 `D:\思源插件\小驴拾遗\`。

## D-0010（2026-09-29）技术栈与工程范式照搬小驴人脉（源码定调）

**定调结论：采用人脉方案（Vite + Svelte 5 + TypeScript + pnpm，CJS 单文件输出），不采用 webpack（打卡/雷切）或无框架样板。**
作者开工前要求先读内核源码定调，以下为 v3.8.5 源码级证据（repos/siyuan）：

1. `app/src/plugin/loader.ts:42-52`——内核以 `window.eval("(function anonymous(require, module, exports){…})")`
   执行插件代码，`require("siyuan")` 由宿主注入（`getAPI()`）→ 插件产物必须是
   **CommonJS 单文件 index.js** 且 `siyuan` 声明为 external；与 vite `lib.formats:["cjs"]` +
   `rollupOptions.external:["siyuan"]` 精确匹配（webpack 亦可但无必要）。
2. `loader.ts:58-68`——模块默认导出必须 `extends Plugin`，否则拒绝加载。
3. `loader.ts:165-174` + `kernel/model/plugin.go:286-294`——`index.css` 由内核整体读取、
   以 `<style id="pluginsStyle<name>">` 注入 → vite `cssFileName:"index"` 输出单份 index.css 即可。
4. `kernel/model/plugin.go:274`——插件目录=`<workspace>/data/plugins/<name>/`，
   装载入口 `/api/petal/loadPetals`；`kernel.js`（goja 内核侧插件）为可选项，本插件不用（同 D-0003 思路）。
5. `kernel/model/plugin.go:296-363`——i18n 按 `Conf.Lang→en→zh-CN` 依次尝试 BCP47 与
   下划线双名（`util.LangToLegacy`，kernel/util/lang.go:66），全未命中回退目录首文件
   → `zh_CN.json + en_US.json` 双名合规且必须**各自全量**（只加载命中的那一份）。
6. `app/src/plugin/index.ts:606-645`——`addAgentCapability({name,description,inputSchema,outputSchema,handler})`
   注册为 `plugin/frontend/<插件名>/<工具名>`，与规划书一致；另发现 `getSecret/getVariable`
   （密钥与变量库，index.ts:568-587）可作未来扩展备用位，不改变"插件不自带 key"红线（D-0004）。

工程范式：api/ 层是唯一内核交互点，domain/ 纯函数层框架无关（architecture 守门测试）；
构建/软链/发版脚本从人脉项目移植；zip 产物 mtime 用真实构建时间（speed-switch 回滚事故教训）。
UI 用 b3 CSS 变量适配主题色，类名前缀 `glean-`。

## D-0011（2026-09-29）UI 设计语言：简约·现代·前沿·科技（作者指示，多轮原型迭代定稿）

作者要求原型 UI 多轮自行优化，参考苹果液态玻璃/HarmonyOS NEXT/Material 3 与 Linear 等现代工具。
定稿设计系统（design/prototype.html 三轮浏览器截图迭代 → 回 port src/index.scss）：
①液态玻璃表面（backdrop blur+saturation、内高光、玻璃搜索/浮动批量条）；
②胶囊分段控件（视图切换滑块、队列 pill，active 态品牌琥珀渐变+投影）；
③Bento 统计卡（渐变大数字 tabular-nums、径向 glow、迷你 spark 柱）；
④卡片语言（16px 圆角、hover 浮起+标题 accent、状态点带光环、spring 微动效 cubic-bezier(.34,1.56,.64,1)）；
⑤iOS inset grouped 设置（chips 选笔记本、滑块开关、行 hover）；
⑥步进器迁移器（扫描→回填→完成三步球）。颜色只用 b3 变量+品牌渐变，明暗主题自适应，前缀 glean-。

## D-0012（2026-09-29）读库看板（AV）与文档属性双轨，状态以属性为真相

T-1200 挂库向导创建的「读库数据库」是属性的投影视图：select 状态列=五态枚举、number=字数/时长、
url=来源。同步方向：向导/刷新时属性→看板（对账补绑+列值对齐）；看板拖卡改列由内核侧生效，
面板打开时 reconcileIndex 以列值回读属性（SQL 已含 ial，属性值优先）。库锚点幂等可续建：
按标题找回宿主文档 → 从块 markdown 还原 avId → 按列名对账补字段（列名记忆在 fieldMap，
用户改列名不伤插件）。行绑定 isDetached:false，itemID≠文档 ID（换算只经
getAttributeViewItemIDsByBoundIDs）。AV 端点形状经 av-spike.mjs 6/6 复验（本仓库 scripts/spike/）。

## D-0013（2026-09-29）AI 消耗控制三态化 + 专用通道研究结论（作者命题）

作者要求：AI 消耗 token，全自动消耗过大，需细化开关；并研究"拾遗单独设置 AI API"的可行性。
1. **消耗控制（本轮已实现）**：富化触发改三态 `enrichMode: off/manual/auto`（默认 **manual**，
   token 消耗需用户显式开自动）；每日上限 `enrichDailyCap`（自动+手动共享额度，超限静默跳过+提示）；
   设置页显示今日用量；语义查重独立开关（dedupOnEnrich——走嵌入不耗 LLM token，与相关旧文同级对待）。
   旧版布尔 enrichOnCapture 归一化兼容（true→auto/false→manual）。旧决策 D-0007 的"收录即富化是默认推荐路径"
   修订为"默认仅手动，用户显式开自动"。
2. **专用通道研究结论（docs/RESEARCH-ai-providers.md）**：思源 v3.8.5 原生多 Provider + 分场景绑模型
   ——用户把「AI 编辑器」绑到免费模型即零开发生效（方案 A，已加引导文案）；"拾遗独立通道"（方案 B：
   getSecret 存 key + 桌面直连 + 浏览器降级）技术可行，但涉及 D-0004 修订与密钥流程设计，
   **待作者拍板后实施**，本轮不实现。

## D-0014（2026-09-29）小驴协同：打卡桥默认关闭，写能力用户显式开启；雷切待文档

T-1505 落地口径（打卡 v5 契约：docs/api-v5.md + contracts/siyuan-checkin-contract）：
1. **打卡桥**：今日拾遗"✓ 读了"→ events.record（source:"api"，externalRef=glean:<docId>:<localDate>
   幂等，宿主去重兜底）。遵守准入五项：探测→whenReady→能力协商→**写能力默认关闭、用户显式开启**
   （settings.integration.checkinEnabled + checkinItemId 从 queryItems 下拉选择）→失败隔离
   （console 留痕保留 externalRef 待重试，绝不抛裸异常进宿主）。前缀 glean: 待向打卡仓库登记。
2. **雷切**：当前无公开 API 文档（源码仅内部引用），协同方向**待雷切文档就绪**，不在本侧臆造。
3. 验收：双插件真机联调（打卡项目选择→重浮"读了"→打卡侧出现事件）登记为 B-0008。

## D-0015（2026-09-29）方案 B 实施：拾遗专用 AI 通道（修订 D-0004 部分口径）

作者命题"针对本插件单独设置 AI API，如果可行再执行"——研究结论可行
（docs/RESEARCH-ai-providers.md），按授权实施：
1. **通道二选一**（settings.ai.channel）：siyuan=官方通道（默认，不变）；custom=拾遗专用
   OpenAI 兼容 API（baseURL/model 用户填，适合免费/低价模型）。
2. **密钥纪律（修订 D-0004 的"全部走思源 /api/ai/*"）**：custom 通道的 API Key 不落插件存储，
   按名从思源「密钥和变量」库经 getSecret() 运行时读取（内核加密）；"插件不自带 key、零预置"红线不变。
3. **降级语义**：browser-* 前端直连受 CORS 限制 → 明确报错引导桌面端；密钥缺失 → 指引创建；
   所有失败静默降级不阻断（与 D-0004 一致）。设置页带"测试连接"。
4. **token 治理不变**：自定义通道同样受 enrichMode 三态与每日上限约束。

## D-0016（2026-09-29）产品重整：先验收可信收录与阅读闭环，再扩展可选能力

作者实际试用 v1.0.4 后反馈“错误百出、逻辑不清、用途不明”，要求沿原想法与调研材料重新梳理使用逻辑。按 [PRODUCT-REPLAN.md](PRODUCT-REPLAN.md) 调整当前开发顺序：

1. 主任务定为“发现有来源证据的文章 → 用户确认收录 → 分拣 → 立即开始读或进入稍后池 → 今日重浮后再读 → 明确读完与回顾”；用户也可主动归档。读库笔记本是扫描范围，扫描到的普通文档不自动视为剪藏；待确认候选不计入五态队列。
2. “代码已实现”“隔离验证通过”“作者真机验收通过”分别记账。现有 M0–M5 功能实现记录保留为历史，当前路线改为 S0–S6 的修复与验收顺序；完整 E2E 未通过前不再把核心闭环称为完成。
3. 属性仍是唯一事实源，AI/AV/导入/收集箱/制卡等为可选能力。既有 `custom-clip-*` 字段语义与任何新字段，须先按 D-0001 更新 DATA-CONTRACT 与迁移方案，再改实现；本决策不直接变更存储契约。
4. 不发布新版本、不提交集市，直到主链 P0 问题关闭并按 RELEASE.md 完成门禁；发布动作继续遵守 D-0005 的逐次请示。
