# HANDOFF — 续跑交接（每轮开发结束更新本页）

> 续跑口令（新会话直接粘贴）：
> **阅读 D:\思源插件\小驴拾遗\docs\HANDOFF.md，按其中"下一步"继续开发；工程纪律见 AGENTS.md 与 docs/DECISIONS.md，UI 以 docs/UI-STANDARD.md 为准，先通读 TODO.md 与 docs/DATA-CONTRACT.md 再动手。**

## 当前状态（2026-09-29 第十四轮开发完成：小项池清空，开发侧全部完成）

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

## 历史速记索引

- 第八轮 导入器 / 第九轮 快照 / 第十轮 制卡 / 第十一轮 收集箱 / 第十二轮 打卡桥（各轮速记见 git 历史）。