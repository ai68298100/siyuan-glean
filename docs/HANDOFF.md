# HANDOFF — 续跑交接（每轮开发结束更新本页）

> 续跑口令（新会话直接粘贴）：
> **阅读 D:思源插件小驴拾遗docsHANDOFF.md，按其中"下一步"继续开发；工程纪律见 AGENTS.md 与 docs/DECISIONS.md，先通读 TODO.md 与 docs/DATA-CONTRACT.md 再动手。**
> 如有更具体的口令，以最近一轮更新的"下一步"为准。

## 当前状态（2026-09-29 第二轮开发完成：UI 设计系统 + M2）

- 仓库：`D:思源插件小驴拾遗` = GitHub [ai68298100/siyuan-glean](https://github.com/ai68298100/siyuan-glean)，main 已推送。
- **UI 设计系统已定稿**（D-0011）：design/prototype.html（三轮浏览器截图迭代）→ src/index.scss。
  语言=液态玻璃+胶囊分段+Bento+弹簧微动效，b3 变量自适应明暗。改 UI 先看 prototype.html 与 index.scss 令牌。
- **M2 功能落地**（v0.2.0 工作版本，未打 tag）：
  - T-1200 挂库向导：services/library-db.ts（ensureLibraryAnchor 幂等续建 + bindAllClipsToLibrary
    分批补绑 + 状态列对齐）；AV 端点封装 src/api/av.ts（av-spike.mjs 6/6 复验，D-0012 双轨语义）。
  - T-1201 统计视图：domain/stats.ts（纯函数，含周报 markdown）+ ui/StatsView.svelte（Bento+分布+导出）。
  - T-1202 高亮视图：services/highlights.ts + ui/HighlightView.svelte（root_id+type='b' 聚合）。
  - 面板三视图（库/统计/高亮）+ 设置改版（iOS inset group + 挂库入口）+ 迁移器步进器化。
- 质量：check 0 错误、30/30 测试、构建+发布门禁全绿、spike 7/7 + av-spike 6/6 回归通过。
- 推送 GitHub 已授权（照常推）；集市仍禁（未授权）。

## 已实证契约（动手前必读 DATA-CONTRACT §5 + spike-report + av-spike-results.json）

- AV：insertBlock 插 NodeAttributeView DOM（客户端预生成 avId）→ renderAttributeView createIfNotExist:true 物化；
  addAttributeViewKey 的 keyIcon 必传空串；绑行 addAttributeViewBlocks isDetached:false；
  换算 itemID 只经 getAttributeViewItemIDsByBoundIDs；number 值形状 {number:{content,isNotEmpty:true}}；
  select 写 content 自动建选项；渲染有异步滞后需重试。
- 其余（attr/batch 形状、LIKE 性能、语义降级、setBazaar 信任门槛、i18n 双名）见第一轮 HANDOFF 内容
  （git 历史或 docs/spike-report.md）。

## 架构速记（增量）

- ui/StatsView/HighlightView 由 DockPanel 内部视图切换承载；跨视图刷新走 facade.notifyDataChanged() 广播。
- domain 层新文件被 node --test 直接 import 时，相对导入必须带 `.ts` 扩展名（stats.ts 先例）。
- 网络：git 推拉走代理 `git -c http.proxy=http://127.0.0.1:7897 …`；GitHub API 也可用该代理 + 凭据管理器令牌（ai68298100）。

## 待作者事项

- B-0001 剪藏扩展实剪核对；B-0002 真机 UI 验收（现在含：三视图/统计/高亮/设置/挂库/迁移器）。
- M2 真机验收后发 v0.2.0（或直接 v1.1.0，与作者确认版本策略——D-005 语义化：里程碑发版 v1.y.0，
  当前 0.x 属预发布工作版本，**建议 M2 验收后直接 v1.1.0**）。
- preview.png 目前是 logo 拉伸图；集市五张截图等真机 UI 后截（README §7 清单）。

## 下一步（M3 AI 富化，按 D-0004/D-0007 红线）

1. **T-1300 富化管线**：收录/手动触发 → /api/ai/chatGPT 摘要 + AI 标签（写 custom-clip-summary/ai-tags，
   永不碰手填字段）+ 语义查重（先查 embeddingStat().enabled，未启用静默跳过）。失败静默降级记 BLOCKERS，
   绝不阻断收录。设置开关已就位（ai.enrichOnCapture）。
2. **T-1301 关联推荐**：阅读中侧栏"相关旧文"；semanticSearchBlock（types:{d:true}，无 boxes——客户端按 box 过滤）。
3. **T-1302 AI 动作**：editor/saveAction 预置 总结/要点/反方观点。
4. **T-1303 智能体工具**：addAgentCapability 三件（list_unread/archive_stale/weekly_digest）。
5. M3 完成后记账+推送+更新本页；再进 M4 抗吃灰（重浮算法 domain 纯函数先行）。
