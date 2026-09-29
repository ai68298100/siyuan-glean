# HANDOFF — 续跑交接（每轮开发结束更新本页）

## 当前有效交接（2026-09-30 S3 收尾第二轮：完成时间与正文诊断，D-0028）

本轮完成 S3 收尾的最后两项代码任务，门禁全绿，未发布新版本：

- **T-1709（S3–S4，契约先行）**：DATA-CONTRACT 新增 `custom-clip-done-time` + 决策 D-0028。
  显式"标记读完"写入/覆盖完成时间（`batchSetStatusDetailed`），归档/恢复不抹除（保留"读过"事实）；
  导入只在导出文件有可靠已读时间时写入（仅 Pocket `time_read`；Omnivore/wallabag 无此字段，保持未知）；
  缺键 = 完成时间未知，**统计 `doneThisWeek` 与周报"本周读完"只按完成时间计**，不再用文档 `updated` 伪造
  （`domain/stats.ts` + `withinWeek`，stats-service 过滤同步改）。旧数据不批量回填。
- **T-1722/T-1727（S3 收尾）**：`domain/content.ts` 新增 `fulltextBodyState`（ok/missing/unmeasured/na，只按已记录测量判断）；
  阅读条（ReadingContext）新增显式"检测正文"（`services/clip-store.ts` `measureClipBody`：导出重算 words/minutes 写回，
  不改用户正文、不删快照）与"重新剪藏"导航（打开原文让用户用官方剪藏扩展重剪，本文不覆盖，同 URL 冲突按 D-0023 裁决）；
  Dock 行表、工作台卡片、看板卡对"全文载体且无字数记录"显示"正文待核"标记（不断言缺失）。
- 顺手修复：Pocket CSV 行短于表头时解析崩溃 → 缺字段按空串（importers.ts 防御式 cell 取值）。
- i18n 双名新增 11 键（clip.bodyCheck / bodyMissing 系列 / reclip 系列 / bodyPending 系列）。
- 门禁：`pnpm check` 0 错误/38 既有告警、`pnpm test` **125/125**、`pnpm build` 通过、
  隔离内核 `scripts/e2e/s1-flow.mjs` **11/11**（新增：标记读完写完成时间+归档保留；空正文显式测量写回）、`git diff --check` 通过。

**仍未做（按序推进）**：S4 的 T-1710（重浮/略过/超龄归档/周报对账真实属性，批量归档前展示清单）与
T-1717（今日拾遗展示推荐理由；开始阅读只进 reading、今天略过幂等——现状基本符合，需补理由展示与对账）；
随后 S5 的 T-1711/T-1712/T-1726/T-1729 与 S6 的 T-1713。真机验收全部集中在 **B-0002**（清单已扩充：
正文待核标记、检测正文/重新剪藏、完成时间统计口径），不要把代码/隔离验证写成平台验收。

历史交接（2026-09-30 上一轮，D-0027）：S3 主体（统一状态动作、时间线筛选、载体策略、阅读上下文）已完成代码与隔离验证；
S1/S2 均已关闭。作者试用 v1.0.4 的反馈已由 S1/S2/S3 修复覆盖，等待真机复核。

> 续跑口令（新会话直接粘贴）：
> **阅读 D:\思源插件\小驴拾遗\docs\HANDOFF.md 的"当前有效交接"与 docs/PRODUCT-REPLAN.md，先重跑最后改动后的门禁，再按 T-1710、T-1717 进入 S4（重浮与回顾对账，涉及口径先对齐 DATA-CONTRACT）；工程纪律见 AGENTS.md 与 docs/DECISIONS.md，UI 以 docs/UI-STANDARD.md 为准；真机项记 B-0002 不冒验收。**

## 历史交接存档

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
