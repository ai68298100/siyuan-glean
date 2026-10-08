# 对外桥接 v1（T-3224 / D-0066）

插件加载并读取设置后在当前宿主窗口注册 `window.siyuanGlean`。它是同窗口插件协同接口，不提供 HTTP 服务，不反向依赖兄弟插件。`apiVersion` 固定为数字 `1`；`version` 来自本次构建的 `plugin.json`，表示插件版本，不能作为协议版本判断依据。

```ts
interface GleanBridge {
    readonly apiVersion: 1;
    readonly version: string;
    listClips(filter?: GleanBridgeFilter): Promise<GleanBridgeClip[]>;
    getClip(id: string): Promise<GleanBridgeClip | null>;
    setClipStatus(id: string, status: ClipStatus): Promise<void>;
}
```

公开 TypeScript 类型见 `src/services/bridge.ts`。所有方法均返回 Promise；参数错误及服务错误通过 Promise 拒绝返回。

## 读取与筛选

`listClips()` 每次执行完整索引对账，再经 clip-store 批量回读当前文档属性；范围查询、对账保存或属性读取失败时拒绝，不返回旧缓存或部分结果。只包含当前属性具有合法五态且没有 `custom-clip-internal=true` 的已收录文档；候选、URL-only 半成品及已删除文档不返回。标题相似不是排除已收录文章的理由。读取不修改文章属性；对账会保存可重建的派生索引。

筛选项可组合，全部必须满足；未指定或空字符串表示不限制。

| 参数 | 语义 |
|---|---|
| `status` | `inbox` / `later` / `reading` / `done` / `archived`，或 `all` |
| `site` | 站点名精确匹配，忽略首尾空白与大小写 |
| `tag` | 用户标签精确匹配，独立于 AI 标签 |
| `aiTag` | AI 标签精确匹配，独立于用户标签 |
| `keyword` | 标题、路径、站点、URL、用户标签、AI 标签中的子串，忽略首尾空白与大小写；不搜索正文 |
| `direction` | 始终按文档 ID 字典序排序：`asc`（默认）或 `desc` |
| `limit` | 默认为 `100`，必须为 1–200 的安全整数 |
| `offset` | 默认为 `0`，必须为非负安全整数 |

先筛选和排序，再分页，返回数组；超出末尾返回 `[]`。不接受数字字符串、小数、NaN、Infinity、null、越界值或错误参数类型；未识别字段忽略，无法通过 `includeCandidates` 等字段纳入候选。分页调用各自读取当前状态，期间文档增删可改变后续页面，不承诺跨调用快照。

`getClip(id)` 只接受 `YYYYMMDDHHmmss-xxxxxxx` 形状的文档 ID，后七位为小写字母或数字。先通过既有只读 SQL 确认文档根块存在，再经 clip-store 读取属性。不存在、非文档块、候选、非法状态、internal 或读取期间已删除时返回 `null`。连接、权限及属性读取失败保留真实错误，不能作为“不存在”吞掉。

所有返回条目均为显式字段白名单创建的新对象，标签数组也独立复制。修改结果不能修改插件内部状态或文档属性。公开字段为：

`id`、`title`、`hpath`、`box`、`updated`、`status`、`url`、`site`、`tags`、`aiTags`、`src`、`time`、`doneTime`、`timeSource`、`contentType`、`words`、`minutes`、`priority`、`rating`、`lastSurfaced`、`pinned`、`summary`、`snapshot`。

`tags` 是用户根块标签；`aiTags` 是 AI 标签。缺失的字符串投影为空字符串，缺失的数字、载体和时间来源为 `undefined`；不把未测量字数伪装成 0。已有时间但没有来源时按 schema 投影为 `legacy`。不返回正文、原始 IAL、候选证据、internal/excluded 标记、设置、密钥或任意属性写接口。

## 状态写入

`settings.integration.bridgeWriteEnabled` 默认 `false`；用户在设置协同区显式开启并保存后才接受写入。每次写入使用当前设置，关闭并保存立即撤销写能力；设置草稿不授予写能力。此开关控制同窗口调用方，不是对恶意同窗口代码的权限隔离。

`setClipStatus(id, status)` 只允许五个合法状态，对文档 ID 和当前收录资格重新校验。它调用 `clip-store.writeClip` 的显式状态动作，只覆盖状态；目标为 `done` 时同时记录当前真实完成时间，离开 `done` 不抹除已有完成时间。来源、优先级、评分、正文和用户标签不受影响。成功写属性并同步派生索引后广播数据变化，Promise 以 `undefined` 完成；不开启、非法参数、候选/internal/不存在或任何写入及索引失败都拒绝。属性可能已经写成而索引保存失败，此时必须核对文档，不能把拒绝解释为事务回滚。

## 生命周期

已有 `window.siyuanGlean` 属性时注册跳过，不覆盖现有对象，包括值为 null/undefined 或从原型继承的占位。卸载立即撤销自身桥接；仅当全局属性仍指向自身对象时删除该属性，保留其他插件后来替换的对象。旧引用、保存的方法引用、排队调用及尚在等待读取结果的调用在卸载后均拒绝。再次加载创建新对象，旧对象不会恢复有效。

同一桥接对象的调用按顺序执行，失败不阻塞后续调用，避免本桥接的对账覆盖本桥接的状态写入。卸载不能撤回已经提交给内核的写请求；正在执行的调用在返回前检查生命周期，卸载后不广播成功，也不返回成功结果。

```js
const bridge = window.siyuanGlean;
if (bridge?.apiVersion === 1) {
    const clips = await bridge.listClips({ status: "later", tag: "技术", limit: 20 });
    const clip = clips.length ? await bridge.getClip(clips[0].id) : null;
    if (clip) await bridge.setClipStatus(clip.id, "reading");
}
```

调用方自行处理 Promise 拒绝；上述写入需要用户先开启开关。破坏性变更必须先升 `apiVersion` 并更新此文档及 DATA-CONTRACT §6。

## 回归验证

`node --test tests/bridge.test.mjs tests/settings.test.ts` 验证真实 clip-store 属性写入与索引同步、筛选分页、数据隔离、传输错误、注册冲突、设置撤销以及卸载后的旧引用。测试通过现有 TypeScript 转译/模块替身方式隔离思源宿主，不连接真实内核、不改用户文章。
