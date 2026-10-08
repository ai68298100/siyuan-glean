# 全库摘录墙

全库摘录墙是只读聚合视图，消费批注插件生成的引述块和带非空 `custom-clip-highlight` 标记的普通块。它不编辑源块，也不新增文章属性或 saveData 数据。

## 数据范围

当前文档模式读取指定根文档。全库模式先调用 `clip-store` 完整对账，再重新读取确认文章的根属性；只有存在有效 `custom-clip-status` 且没有 `custom-clip-internal=true` 的根文档进入范围。候选、普通笔记、内部文档和旧索引幽灵不会进入摘录墙。

根文档 ID 按最多 200 个分批。摘录查询每页最多 500 个，以块 ID 升序作为稳定 keyset 游标。查询消费 `type='b'` 的引述块，或 `ial` 中非空的 `custom-clip-highlight` 标记；未标记子段落不会因为同属引述结构而重复出现。

## 内存视图

搜索匹配摘录正文、文章标题、站点、来源 URL、用户标签和 AI 标签。站点、用户标签、AI 标签分别筛选；排序与分页只作用于内存投影，不写回文档。选择集合按块 ID 保存，刷新后只保留仍然存在的块。

## 导出边界

复制、CSV 和 Markdown 整理稿只处理显式选择。Markdown 将摘录作为纯文本逐行转义，并写入文章根块、原摘录块和安全来源 URL 的回链；CSV 每个单元格都进行引号处理和公式前缀防护。

每次复制、下载或预览前，都重新核对根文档资格、笔记本、路径、块归属、块类型、IAL 标记、纯文本和 Markdown。删除、权限错误或任意内容变化都会阻止旧选择导出，界面显示错误并保留选择供刷新或重试。

## 整理稿恢复

确认预览后在首条摘录所属笔记本创建 ordinary 文档。创建成功后只通过 `clip-store.writeClip` 标记 `custom-clip-internal=true`，不复制文章状态、来源、评分、优先级或标签。

保存期间禁止并发创建。建文档响应丢失或返回非法 ID 时，创建结果视为未知，当前预览不得自动再次创建。文档已创建但内部标记或索引失败时保留文档 ID，后续操作只复用该 ID；恢复前会再次核对笔记本、路径和未被用户收录的文档属性。

## API 入口

服务层入口位于 `src/services/highlights.ts`：

- `listDocHighlights(rootDocId)`：读取当前文档摘录。
- `listLibraryHighlights(plugin, settings)`：对账后读取全库摘录。
- `prepareHighlightExport(items, selectedIds, labels)`：复核选择并生成内存预览。
- `revalidateHighlights(items)`：在复制、CSV、预览和确认前复核源数据。
- `saveHighlightDraft(plugin, session)`：创建或恢复独立 internal 整理稿。
