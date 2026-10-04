# 中英文术语表

> T-3209，2026-10-04。术语描述用户看到的状态和动作，不把内部字段名直接当成 UI 文案。

| 语义 | 中文 UI | English UI | 使用规则 |
|---|---|---|---|
| `inbox` 状态 | 待分拣 | New | 文章已进入读库但尚未分拣；“思源收集箱”专指外部收集箱服务，不翻成 New |
| `later` 状态 | 稍后读 | Read later | 用户明确推迟阅读 |
| `reading` 状态 | 阅读中 | Reading | 只有开始阅读动作写入 |
| `done` 状态 | 已读 | Finished | 只有用户明确标记完成；英文不使用 ambiguous 的 “Done” 作为文章状态 |
| `archived` 状态 | 归档 | Archived | 归档不抹除完成历史 |
| candidate | 候选 | candidate / Needs review | 尚未写入读库属性；候选依据与缺失项必须可见 |
| source evidence | 来源证据 | source evidence | 有效 URL、精确 `#剪藏` 标签、剪藏模板来源行或独立来源链接 |
| triage | 分拣 | triage | 在五态之间做显式状态选择；不译成自动整理 |
| resurface | 今日拾遗 / 重浮 | Today's gleaning / resurface | 今日拾遗是产品入口；resurface 只用于技术和说明文档 |
| defer | 改天 | Defer | 只影响当天展示，不改变完成状态 |
| undo | 撤销 | Undo | 仅在文章状态和重浮标记没有被外部修改时可用 |
| offline | 离线 | Offline | 保留已有缓存内容；连接恢复后重试 |
| retry | 重试 | Retry | 连接/内核恢复后由用户重新执行失败动作 |
| snapshot | 快照 | Snapshot | 思源文档的单文件 HTML 资产，不是重新抓取网页 |
| check-in bridge | 打卡桥 | Checkin bridge | 可选外部协同；桥接失败不阻断已读状态 |

状态名 `inbox/later/reading/done/archived` 在数据契约、属性和代码中保持原值；面向用户的界面统一使用上表的自然语言。新增文案先更新本表，再同步 `public/i18n/zh_CN.json` 与 `public/i18n/en_US.json`。
