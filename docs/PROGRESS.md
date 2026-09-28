# 进度（PROGRESS）

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
