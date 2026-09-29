# 进度（PROGRESS）

## 方案 B — 拾遗专用 AI 通道实施 ✅（2026-09-29，第十五轮；T-1300c）

- [x] domain/ai-direct.ts（URL 拼接/载荷/响应解析/前端降级判定，纯函数）
- [x] api/ai-direct.ts（直连 chat/completions：getSecret 读密钥→60s 超时→防御式解析；
      browser-* CORS 明确报错）+ testDirectChannel（设置页测试连接）
- [x] enrich-service callLLM 通道路由（custom 直连 / siyuan 官方，token 治理不变）
- [x] 设置 AI 组改版：通道二选一分段 + 自定义三字段 + 测试连接；238 i18n 键
- [x] 质量门禁：check 0 错、71/71 测试、构建+门禁全绿、spike 9/9
- 联调（作者）：真实免费 API 测试连接与富化（并入 B-0004）

## E2E 启动器 + 纯浏览器限制调查 ✅（2026-09-29，第十三轮）

- [x] scripts/e2e/launch-e2e.mjs：隔离工作区+真实 dist+信任启用+演示数据（4 篇各状态剪藏），
  一条命令拉起完整可联调环境（内核侧全通过：loadPetals 含插件、i18n 227 键）
- [x] 调查：桌面 stage 构建含 electron 外部引用，纯浏览器启动必然中止——环境限制非插件缺陷
  （排除过程：启动 API/资源全 200、/ws 内外均 OPEN、主模块 require(electron) 即崩）
- [x] 结论与替代覆盖落账 docs/RESEARCH-browser-e2e.md + BLOCKERS B-0009；
  Electron 自动化/真机客户端两条路径待作者需要时投入

## 小项池清空 ✅（2026-09-29，第十四轮）

- [x] 导入器大文件分页预览（50 行/页 + 上一页/下一页；T-1501a）
- [x] 批量收录进度提示（收录中 done/total → 完成含富化入队数）
- [x] 重浮卡分卡渐显入场（60ms 递进一次性动效，动效预算内）
- [x] docs/media/ 目录建立（拍摄清单就位，等真机材料）
- [x] 质量门禁：check 0 错、71/71 测试、构建+门禁全绿、spike 9/9（227 i18n 键）

## M5 — T-1505 小驴协同（打卡桥）✅（2026-09-29，第十二轮）

- [x] 研究：打卡 v5 契约完整可消费（探测/whenReady/20 项能力/recordEvent 幂等语义）；
      雷切无公开 API，方向待其文档就绪（B-0008 附注）
- [x] services/checkin-bridge.ts：探测+whenReady+能力协商（items.query/events.range.read/events.record）
      + recordReadingDone（externalRef=glean:<docId>:<localDate>，失败隔离留痕重试语义）
- [x] 设置协同组：开关（默认关）+ 阅读打卡目标下拉（queryItems 拉取）；
      重浮"✓ 读了"钩子 fire-and-forget
- [x] 质量门禁：check 0 错、71/71 测试（checkin 4 项）、构建+门禁全绿、spike 9/9（222 i18n 键）
- 联调（作者）：双插件真机验证（B-0008）

## M5 — T-1500 收集箱 ✅（2026-09-29，第十一轮；联调待作者订阅账号 B-0007）

- [x] 契约核实：getShorthands {page} → **双层包裹**（response.data.data.shorthands，云收件箱特有形状）；
      Shorthand 含 shorthandURL（官方前端丢弃、本插件保留）；open-menu-inbox detail {ids, element}
- [x] api/inbox.ts（防御式剥包 + getShorthand 单条）+ services/inbox-service
      （迁入=建文档+captureClip(src=inbox)+云端时间覆盖；云端删除失败不阻塞）
- [x] UI：库视图顶部"📥 思源收集箱"折叠区（未登录/无订阅整块隐藏）；条目 迁入/忽略(云端删除)
- [x] 编辑器外第二右键：open-menu-inbox 注入"迁入读库（选中 N 条）"
- [x] 质量门禁：check 0 错、67/67 测试、构建+门禁全绿、spike 9/9（216 i18n 键）

## M5 — T-1502 摘录制卡 ✅（2026-09-29，第十轮）

- [x] spike ⑧ 制卡闭环（createDeck→insertBlock→addRiffCards，**9/9**）：
      卡块范式=列表项（父内容=正面，嵌套子列表=背面，官方闪卡标准）——段落嵌套 DOM 被内核拒（踩坑已记）
- [x] api/riff.ts + domain/flashcard.ts（卡面构造/DOM 转义，5 单测）+ services/flashcard-service.ts
      （牌组+宿主文档幂等续建；v1 不耗 token，AI 问句化留动作钩子）
- [x] UI 入口三件：高亮卡 🎴 制卡按钮 / 命令"摘录制卡(选中文本)" / 编辑器右键菜单（显示选中字数）
- [x] 架构守门测试立功：flashcard-service 裸调端点被抓 → 重构走 api 层（insertBlockDom 入 client.ts）
- [x] 质量门禁：check 0 错、67/67 测试、构建+门禁全绿、spike 9/9（209 i18n 键）
- 制卡验收（作者）：真实闪卡复习流程里确认卡片正背面渲染（B-0002 扩充）

## M5 — T-1504 全页快照 ✅（2026-09-29，第九轮）

- [x] 契约核实：`/api/export/exportHTML {id,pdf}` → data{name,content}（单文件 HTML）；
      `/api/file/putFile` 为 **multipart**（path+file，apicontract/file.go）——宿主 fetchPost 原生透传
      FormData（app/src/util/fetch.ts:35），api/assets.ts 落地
- [x] snapshot 属性入契约与索引（custom-clip-snapshot 存 assets 路径）
- [x] services/snapshot-service：exportHTML → putFile 写 /<笔记本>/assets/glean-<id>-<ts>.html →
      写快照属性；面板卡/行表 📷 动作（有快照=⟐ 打开资产，无=拍摄）；openTab asset 打开
- [x] spike 增 ⑦ 快照闭环（exportHTML→putFile→getFile 读回含正文）**8/8 通过**；
      ⑥ 修正为 id+LIKE 精确断言+索引滞后重试（SQLite ial 异步刷新踩坑）
- [x] 质量门禁：check 0 错、62/62 测试、构建+门禁全绿（204 i18n 键，CSS 27.6KB）

## M5 启动 — T-1501 迁移导入器 ✅（2026-09-29，第八轮；按作者"继续开发+推荐项先行"授权启动 M5）

- [x] domain/importers.ts：Pocket HTML/CSV、Omnivore JSON、wallabag JSON 四格式解析
      （防御式解析坏行跳过；URL 去重含尾斜杠归一；状态映射 unread→inbox/read→done/archive→archived）
- [x] services/import-service.ts：preview（解析+库内 URL 去重标记）+ runImport
      （建文档 → captureClip 写 URL/站点/时间/src=import-* → 外部标签写用户 tags 位 → 状态映射）
      时间保留原服务收藏时间（epoch/ISO → 思源本地墙钟）
- [x] ui/ImportDialog.svelte：文件选择 → 预览表（三统计卡+重复标记）→ 进度 → 完成三类汇总；
      目标笔记本/目录可选；设置-维护入口 + facade.openImport
- [x] spike ⑥ 断言修正（id+LIKE 精确断言替代 updated 排序窗口，工作区复用下不再顺序敏感）
- [x] 质量门禁：check 0 错、62/62 测试（importers 11 项）、构建+门禁全绿、spike 7/7（201 i18n 键）
- 导入器验收（作者）：拿真实 Pocket/Omnivore 导出文件跑一遍（B-0005 新增）

## 发布准备 + 技术债 ✅（2026-09-29，第七轮）

- [x] T-1300d 富化队列串行化：批量收录时 auto/manual 富化逐个执行（enqueue promise 链），
      防并发打满模型；手动与自动共享同一队列防重复
- [x] 面板视图偏好持久化（services/prefs.ts ui-prefs.json，只存界面偏好不碰文章数据）
- [x] AI 日志查看入口：设置-维护"AI 日志"展开最近 20 条失败记录（loadAiLog，新的在前）
- [x] 发布材料：docs/CHANGELOG.md 建立（v1.0.0 候选全量条目）+ docs/RELEASE-MEDIA.md
      （头图 GIF 六步脚本 / 集市五张截图 shot list / 关键词自查 / 上架检查单）
- [x] 质量门禁：check 0 错、53/53 测试、构建+门禁全绿、spike 7/7（181 i18n 键）

## AI 消耗控制 + 专用通道研究 ✅（2026-09-29，作者命题）

- [x] 富化三态触发 off/manual/auto（默认 manual，token 需显式开自动）+ 每日上限 + 今日用量显示
- [x] 语义查重独立开关（嵌入通道，不耗 LLM token）；旧 enrichOnCapture 布尔归一化兼容
- [x] 每日上限门卫进 enrichClip（auto/manual 共享额度，超限 skipped:"cap" + 提示）；用量 ai-usage.json 按日重置
- [x] 研究：思源原生多 Provider+场景绑定（方案 A 零开发可用，已加引导）；拾遗专用通道方案 B 可行待拍板
      （docs/RESEARCH-ai-providers.md + D-0013）
- [x] 质量门禁：check 0 错、53/53 测试（settings 兼容 5 项）、构建+门禁全绿、spike 7/7（177 i18n 键）

## M4 — 抗吃灰内核（v0.4.0 工作版本，待真机验收）✅（2026-09-29）

- [x] T-1400 每日重浮：domain/resurface.ts 纯函数——确定性挑选（stableHash(id+日期) tiebreak，
  同池同日跨重启结果一致）、lastSurfaced=当天幂等排除、近 7 天重浮标签重叠多样性降权、
  priority 加权；lastSurfaced 只在用户行动时写（未行动明天自然回池，平静原则）。11 项单测。
- [x] T-1402 今日拾遗视图：面板第四视图且为默认首屏；原型帧一次过审回 port
  （渐变左条大卡+✨拾遗标签+AI摘要+改天/归档/读了三按钮+平静脚注）；空态 🌱"明天再见，不用有负担"
- [x] T-1401 配额与超龄：inbox 超 quota 温和横幅 + 超龄归档候选横幅一键批量归档
  （staleCandidates 纯函数 + archiveStale 服务）
- [x] 索引/域链路补 summary 字段（重浮卡展示 AI 摘要）
- [x] 质量门禁：check 0 错、48/48 测试、构建+门禁全绿、spike 7/7（165 i18n 键，CSS 26.9KB）
- 真机验收项（作者）：重浮挑选实际观感与"读了/改天"手感（B-0002 扩充）

## M3 — AI 富化（v0.3.0 工作版本，待真机验收）✅（2026-09-29）

- [x] T-1300 富化管线：services/enrich-service.ts（chatGPT 摘要+AI标签 → 写 ai-tags/summary，
      永不碰手填字段；语义查重先查 embeddingStat.enabled；失败静默写 ai-log.json 最近 50 条）
      + domain/enrich.ts（prompt 构造/鲁棒 JSON 解析/bigram 判重，7 项单测）
- [x] T-1301 相关旧文：高亮视图底部 ✨ 相关旧文（semanticSearchBlock 文档级，嵌入未启用整块隐藏）
- [x] T-1302 预置 AI 动作：拾遗·总结/要点/反方观点（editor/saveAction 幂等补建，不覆盖用户改过的 prompt）
- [x] T-1303 智能体工具三件：list_unread / archive_stale / weekly_digest（addAgentCapability）
- [x] T-1400c 桌面 rail+行表：tab 画布 列表模式升级为 200px rail（队列/站点/标签，点击即筛）
      + drow 五列行表（状态点/标题/站点/字数时长/徽章+悬浮✨⤓勾选）
- [x] 面板卡 ✨ 手动富化按钮 + 收录后自动富化（fire-and-forget 不阻塞）
- [x] 契约修正：/api/ai/chatGPT 请求为 {msg:string}（规划书 msgs 数组说法有误），DATA-CONTRACT 已更
- [x] 质量门禁：check 0 错、37/37 测试、构建+门禁全绿、spike 7/7（155 i18n 键，CSS 25.1KB）
- 真机验收项（作者，需配置 AI 模型）：富化/查重/相关旧文/AI 动作/智能体工具的实际效果（B-0004）

## UI 标准 — 桌面端定稿 + 规范成文 ✅（2026-09-29，第三轮 UI 迭代）

- [x] 桌面原型四帧（design/prototype.html）：库 tab（216px rail + 五列行表）/ 五列看板 / 全宽统计
      （4 卡 Bento + 周柱图 + 双列分布）/ 双栏设置；浏览器截图迭代三轮
      （修：drow 列宽换行、kcard 徽章换行、big-chart 百分比高度）
- [x] **docs/UI-STANDARD.md v1.1 成文**（贯穿开发周期的 UI 契约）：设计原则/令牌表/三档画布
      （Dock 320 / Tab 全宽 / 对话框）/组件词表（与原型同词表）/场景标准（看板/AI 预留/文案）/实现守门
- [x] AGENTS.md 铁律 6 升级为"一切 UI 以 UI-STANDARD 为准"
- [x] 回 port：tab 宽幅响应式（列表网格化 + Bento 4 列）+ 看板 v1（HTML5 拖卡=batchSetStatus，
      列 hover 橙虚线落点提示，仅桌面画布）+ 150 i18n 键
- 质量门禁：check 0 错、30/30 测试、构建+门禁全绿、spike 7/7（CSS 21.8KB）

## M2 — 数据库视图与统计（v0.2.0，功能落地待真机验收）✅（2026-09-29）

- [x] UI 设计系统定稿：design/prototype.html 三轮浏览器截图迭代（玻璃/胶囊/Bento/弹簧）→
      src/index.scss 全量回 port；面板改版为 库/统计/高亮 三视图（D-0011）
- [x] T-1200 挂库向导：av-spike 6/6 复验（建库/字段/绑行/itemID/写值/渲染）；
      ensureLibraryAnchor 幂等续建 + bindAllClipsToLibrary 分批(≤50)补绑 + 状态列对齐（D-0012）
- [x] T-1201 统计视图：domain/stats.ts 纯函数聚合（7 天收录桶 noon 对齐修正）+ Bento 卡 +
      站点/标签分布 + Markdown 周报导出（读库周报/）
- [x] T-1202 高亮视图：当前文档引述块聚合（SQL root_id+type='b'，sort ASC），只消费不编辑
- [x] 质量门禁：check 0 错误、30/30 测试、构建+发布门禁全绿、spike 7/7 回归（含新 dist 加载 148 i18n 键）
- [x] 设置面板回 port：iOS inset grouped + chips + 滑块开关 + 挂库入口
- [x] 迁移器回 port：步进器 + 统计卡 + 状态胶囊表格
- 真机验收项（作者）：dock/顶栏/三视图/迁移器/设置/挂库 的实机操作（B-0002 扩充）

## M0 — 尖刺验证 ✅（2026-09-29）

- [x] 仓库骨架：git init、真值文档八件套、AGENTS.md、D-0001~D-0010 落账（含源码定调 D-0010）
- [x] 头像 icon.png（小驴系列风格：琥珀渐变卡片 + 白麦穗 + 落粒，gen-icon.mjs 变体 a）+ 过渡 preview.png
- [x] 脚手架：Vite 8 + Svelte 5 + TS + pnpm；构建/发版/图标脚本齐；发布门禁 14/14 PASS
- [x] M0 spike **7/7 通过**（隔离内核 ~/SiYuan-Glean-Spike）：属性闭环/千篇库 LIKE 14~50ms/
      语义双态/exportMdContent/插件加载+i18n 双名/双锚点 SQL。报告：docs/spike-report.md
- spike 三项契约修正进 DATA-CONTRACT §5（batch 映射形状 / semanticSearch types map 无 boxes /
  embeddingStat 字段）；T-1403 关闭（SQL 直查够快，索引降级为缓存）
- 后置给作者：剪藏扩展实剪核对（B-0001）、dock/顶栏真机目视（B-0002）

## M1 — 地基 v0.1.0（功能代码全量落地，待真机验收后发 v1.0.0）✅（2026-09-29）

- [x] T-1100 属性服务层 clip-store（schema 校验 + 幂等 + 手填字段保护 + 批量状态 + 对账/重建）
- [x] T-1100a domain 纯函数（schema/迁移启发式）+ 25 项单测全绿
- [x] T-1100b api 层（attr/sql/notebook/export/semantic 全部 spike 实证形状）
- [x] T-1101 设置视图（锚点笔记本多选 / AI 开关组 / 重浮参数 / 批量大小 / 索引重建）
- [x] T-1102 迁移器（dry-run 报告 → ≤50/批可暂停续跑 → 完成报告三类；进度持久化）
- [x] T-1103 状态机与批量操作（五态白名单 + 多选批量）
- [x] T-1104 Dock 面板（五队列 + 待收录区 + 一键全部收录 + 搜索 + 排序 + 批量条）
- [x] T-1105 收录入口三件套（面板/右键菜单/命令）
- [x] T-1106 命令（打开面板 ⌥⌘G / 加入读库 / 整理剪藏库）
- [x] T-1107 派生索引 glean-index.json（写入同步 + 面板对账 + 重建）
- [x] T-1109 README 中英双版 + 集市关键词补偿
- [x] 架构守门测试（domain 纯净 / 端点只准 api 层 / UI 禁 fetch）
- 验收口径：pnpm check 0 错误、25/25 测试、构建 + 发布门禁全绿、隔离内核加载插件通过；
  **真机 UI 验收与 M1 发版（v1.0.0 打 tag）等作者有空时进行（作者指示后置）**
