# M0 Spike 报告

> 执行：2026-09-29，隔离内核（`D:\RJ\SiYuan`，工作区 `~/SiYuan-Glean-Spike`，端口 6831 回环，标记文件护栏，绝不触碰真实笔记）。
> 脚本：`scripts/spike/glean-spike.mjs`；原始结果：`scripts/spike/spike-results.json`。
> 结论：**7/7 通过**。规划书 §3 的技术事实全部实证成立，三处契约细节与规划书有出入，已修正 DATA-CONTRACT 与 api 层。

## 结果一览

| # | 验证项 | 结果 | 关键数据 |
|---|---|---|---|
| ① | 属性写读闭环 + tags 落位 + 批量端点形状 + 删除语义 | ✅ | 全部一致 |
| ② | 千篇库 `ial LIKE` 性能 | ✅ | LIKE=14~50ms（命中 506）；boxIN500=30~48ms；batchAttrs1000=0.7~1.1s |
| ③ | semanticSearchBlock / embeddingStat 双态 | ✅ | 见「语义搜索」 |
| ④ | exportMdContent 形状 | ✅ | `{hPath, content}`，content 含模板链接行 |
| ⑤ | 插件包加载 + i18n 双名 | ✅ | loadPetals 返回 js/css/i18n；按 Conf.Lang 正确加载 |
| ⑥ | SQL 双锚点查询 | ✅ | LIKE 圈定收录文档；box IN 圈定锚点笔记本 |

## 各项结论

### ① 属性读写（DATA-CONTRACT §1 的地基）

- 官方剪藏扩展 payload 形态（`createDocWithMd` 带 `tags` + 模板链接行）实证：**tags 被内核写入根块 IAL 的 `tags` 键**（规划书 §3.1 成立）。
- `setBlockAttrs` 写 `custom-clip-*` → `getBlockAttrs` 读回逐键一致。
- **批量端点形状与规划书略异**（已修 DATA-CONTRACT §5 / api 层）：
  - `batchGetBlockAttrs` 请求 `{ids}` → 响应 **`{[id]: attrs}` 映射**（不是数组）；
  - `batchSetBlockAttrs` 请求 **`{blockAttrs: [{id, attrs}]}`**（不是 `{reqs}`）。
- **删除语义：`null` 与空串 `""` 都能删除属性键**（两种都验证通过；插件统一用 null）。

### ② 千篇库性能 —— T-1403 的答案

- `ial LIKE '%custom-clip-status%'` 千篇库直查 **14~50ms**，LIMIT 1000 → **MVP 直查 SQL 可行，不必先建 saveData 索引**（T-1403 关闭，索引仅作为派生缓存保留）。
- `batchGetBlockAttrs` 1000 篇 **0.7~1.1s**，是最贵的一步 → 面板对账分页/限量（现有 reconcileIndex 已按 LIMIT 控制）。

### ③ 语义搜索（M3 降级设计的依据）

- `embeddingStat`（启用前）：`{"total":6066,"indexed":0,"pending":6066,"failed":0,"ignoredByLen":0,"ignoredByConfig":0,"enabled":false}`，code=0。
- `semanticSearchBlock`：**嵌入未启用时不报错，code=0 + 空 blocks**。
  → **M3 降级逻辑必须先查 `embeddingStat().enabled`，不能依赖报错**（api 层已同步形状）。
- **请求契约与规划书 §3.2 有出入**：`types` 是 `map[string]bool`（`{"d": true}`）；
  **请求没有 `boxes` 参数**（框定笔记本需客户端过滤或走 paths）——"全市场无人消费 semanticSearch" 的卖点不变，但 M3 关联推荐要做客户端 box 过滤。

### ④ 迁移器读正文

- `exportMdContent {id}` → `{hPath, content}`，content 为 markdown 且含模板链接行 → 迁移启发式可用。

### ⑤ 插件加载 + i18n（D-0010 的运行时验证）

- dist 拷入 `<workspace>/data/plugins/siyuan-glean` 后，**需先 `/api/setting/setBazaar {trust:true}`**（桌面 std 容器集市信任门槛，kernel/model/plugin.go `IsPetalsEnabled`），`loadPetals` 才返回插件。
- petal 携带 js/css/i18n 全量；vite 产线 minify 后类名被重命名，加载判定用稳定字符串（`glean-dock`/`cmd.openPanel`）。
- i18n：隔离工作区 `Conf.Lang=en` → 正确加载 `en_US.json`（123 键完整）；内核回退链（Conf.Lang→en→zh-CN，BCP47/下划线双名）按预期工作 → **双名规范成立**。

### ⑥ 双锚点 SQL（面板数据源）

- 次锚点 `ial LIKE '%custom-clip-status%'` 与主锚点 `box IN` 两条语句形状、过滤正确性均验证通过。

## 对规划的修订

1. **T-1403 关闭**（SQL 直查够快，索引降级为缓存，见 ②）。
2. **T-1300/T-1301 设计修正**：语义降级先查 `embeddingStat.enabled`；关联推荐无 boxes 过滤需客户端过滤（见 ③）。
3. **DATA-CONTRACT §5 端点形状更新**：batch 两端点 + semanticSearchBlock + embeddingStat。
4. **E2E 基建提示**：隔离内核测试插件前必须 setBazaar trust（写进 spike 脚本注释，后续 E2E 复用）。

## 后置项（作者操作，BLOCKERS B-0001/B-0002）

- 官方剪藏扩展实剪 3 站核对（程序侧已按扩展源码 payload 模拟验证）。
- addDock/addTopBar 真机目视呈现（代码层已按内核 mountPlugin 逻辑落定）。
