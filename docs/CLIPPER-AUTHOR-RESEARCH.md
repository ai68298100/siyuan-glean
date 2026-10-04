# 官方剪藏扩展的作者字段研究（T-1815，2026-10-04）

当前官方扩展不能仅靠自定义模板自动把公众号名称写入作者字段。推荐先使用 T-3239 的手动编辑；AI 建议与逐条确认继续由 T-1813 承接。不能把 `${siteName}` 当作公众号署名，也不能在模板中运行网页选择器。

## 证据范围

官方仓库 [siyuan-note/siyuan-chrome](https://github.com/siyuan-note/siyuan-chrome)，固定提交 `00182d4b5cd40bba0ee48c768740786a9a69235a`，manifest 版本 `1.15.15`。本地只读副本为 `C:\Users\sunku\AppData\Local\Temp\glean-clipper-research-1791109884660`。思源内核对照为本地 `D:\AI\tmp-siyuan-source` 的 3.8.6 源码。版本不同需重新核查，不将源码与函数探针等同于作者已安装扩展的实剪结果。

## 数据在哪里丢失

| 环节 | 可见能力 | 对作者的影响 |
|---|---|---|
| [Readability metadata](https://github.com/siyuan-note/siyuan-chrome/blob/00182d4b5cd40bba0ee48c768740786a9a69235a/lib/Readability.js#L1549) | 可从 JSON-LD author、dc/dcterm creator、name=author 和部分 byline DOM 获取署名 | 解析结果可能有 byline，但不是所有网站都有；此处并没有使用 og:author 作为最终 byline 优先项 |
| [Readability 输出](https://github.com/siyuan-note/siyuan-chrome/blob/00182d4b5cd40bba0ee48c768740786a9a69235a/lib/Readability.js#L2533) | 返回 byline、title、content、excerpt 等 | 已解析的署名可以存在于 article.byline |
| [content 消息](https://github.com/siyuan-note/siyuan-chrome/blob/00182d4b5cd40bba0ee48c768740786a9a69235a/content.js#L1187) | 只把 article.title/siteName/excerpt 等选入 msgJSON | 没有传输 article.byline；没有 #js_name 专用署名提取 |
| [Markdown 模板数据](https://github.com/siyuan-note/siyuan-chrome/blob/00182d4b5cd40bba0ee48c768740786a9a69235a/background.js#L187) | title/siteName/excerpt/url/urlDecoded/date/time/tags/content | 没有 author 或 byline 变量；即使给 requestData 注入 author，构建模板数据时也丢弃 |
| [模板渲染](https://github.com/siyuan-note/siyuan-chrome/blob/00182d4b5cd40bba0ee48c768740786a9a69235a/background.js#L122) | 变量/点路径、有限条件和字符串拼接；未知变量为空 | 不是 JavaScript 求值器，不能执行 document.querySelector，也没有任意 CSS 选择器映射设置 |
| [建文档请求](https://github.com/siyuan-note/siyuan-chrome/blob/00182d4b5cd40bba0ee48c768740786a9a69235a/background.js#L357) | markdown/tags/path/clippingHref 等 | 没有作者属性映射，不承诺模板直接写根块 IAL 的可用性 |

模板中的固定“作者：某名称”属于用户手填常量；它不会随当前页面自动变化，不适合作为通用公众号提取。

## 可复现函数探针

运行：`node scripts/spike/clipper-author-probe.mjs <官方扩展源码目录>`。探针核对固定提交，仅在隔离 VM 中加载已审阅的两个模板函数，没有访问网页、账号、思源 API 或作者窗口。

- `${author}|${byline}` 在现有模板数据上输出 `|`。
- `${document.querySelector("#js_name").textContent}` 输出空字符串，不执行选择器。
- `${siteName ? " · " + siteName : ""}` 正常输出站点，表明条件模板仍有效。
- requestData 同时提供 author/byline 时，真实 buildClipMarkdown 用 `${author}|${byline}|${content}` 仍输出 `||Body`。

## 后续建议与验收边界

如推进上游适配，需要在页面上下文获取候选署名（可用的 Readability.byline；微信页 #js_name 单独验证），显式传给 background 并增加模板变量。进入本插件的署名应携带可核对的来源证据，通过 clip-store 保护已有值；元数据中的链接、多个作者或站点名不能直接当单一作者。普通页面、选区剪藏、动态微信页、登录页和模板/数据库两条建文档路径均需真实样本。

本轮不改作者浏览器设置，不提交上游 issue/PR，不追加未实证端点。T-1815 的固定版本能力研究完成；真实扩展产出继续归 B-0001，AI 推断效果归 B-0004。未来版本若开放署名变量，再重跑探针并按契约立适配任务。
