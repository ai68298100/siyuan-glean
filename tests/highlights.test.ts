import test from "node:test";
import assert from "node:assert/strict";
import {
    cleanHighlightText, escapeHighlightText, filterHighlights, highlightBlockLink, highlightFacets, highlightMarker,
    pageHighlights, renderHighlightsCsv, renderHighlightsMarkdown, retainHighlightSelection, safeHighlightCsvCell,
    selectHighlights, type HighlightItem,
} from "../src/domain/highlights.ts";

const rootId = "20261004100000-aaaaaaa";
const labels = { title: "摘录汇编", original: "返回原块", source: "来源网页" };

function item(offset: number, overrides: Partial<HighlightItem> = {}): HighlightItem {
    return {
        id: `20261004120000-${String(offset).padStart(7, "0")}`, rootId, title: "文章", text: "正文摘录", markdown: "> **正文摘录**",
        box: "box-1", hpath: "/folder/文章", site: "example.test", tags: ["用户"], aiTags: ["模型"], url: "https://example.test/article",
        source: { content: "正文摘录", markdown: "> **正文摘录**", type: "b", highlight: "" }, ...overrides,
    };
}

test("搜索覆盖摘录及文章元数据，站点和两种标签独立精确筛选", () => {
    const items = [item(1), item(2, { tags: ["模型"], aiTags: ["用户"], site: "other.test", text: "other text" })];
    assert.deepEqual(filterHighlights(items, { search: "正文 EXAMPLE", site: "example.test", tag: "用户", aiTag: "模型" }).map((value) => value.id), [items[0].id]);
    assert.deepEqual(filterHighlights(items, { tag: "模型" }).map((value) => value.id), [items[1].id]);
    assert.deepEqual(filterHighlights(items, { aiTag: "模型" }).map((value) => value.id), [items[0].id]);
    assert.equal(filterHighlights(items, { tag: "用" }).length, 0);
    assert.equal(filterHighlights(items, { search: "no-match" }).length, 0);
    assert.deepEqual(highlightFacets(items), { sites: ["example.test", "other.test"], tags: ["模型", "用户"], aiTags: ["模型", "用户"] });
});

test("稳定排序用块 ID 打破相同标题，纯投影不改变输入", () => {
    const items = [item(3, { title: "B" }), item(2, { title: "A" }), item(1, { title: "A" })];
    const before = structuredClone(items);
    assert.deepEqual(filterHighlights(items, { sort: "title", direction: "asc" }).map((value) => value.id), [items[2].id, items[1].id, items[0].id]);
    assert.deepEqual(filterHighlights(items, { sort: "title", direction: "desc" }).map((value) => value.id), [items[0].id, items[2].id, items[1].id]);
    assert.deepEqual(filterHighlights(items, { direction: "desc" }).map((value) => value.id), [items[0].id, items[1].id, items[2].id]);
    assert.deepEqual(items, before);
});

test("分页处理最后页、空结果与非法页值", () => {
    const items = Array.from({ length: 41 }, (_, offset) => item(offset + 1));
    assert.equal(pageHighlights(items, 2).items.length, 20);
    assert.deepEqual(pageHighlights(items, 999), { items: [items[40]], page: 3, pages: 3, total: 41 });
    assert.equal(pageHighlights(items, Number.NaN, -1).page, 1);
    assert.deepEqual(pageHighlights([], 8), { items: [], page: 1, pages: 1, total: 0 });
});

test("多选跨页保留，导出只消费显式 ID，不将空选解释为全部", () => {
    const items = [item(1), item(2), item(3)];
    assert.deepEqual(selectHighlights(items, [items[2].id, items[0].id]), [items[0], items[2]]);
    assert.deepEqual(selectHighlights(items, []), []);
    assert.deepEqual(retainHighlightSelection(items.slice(1), [items[0].id, items[2].id, items[2].id]), [items[2].id]);
    assert.throws(() => selectHighlights(items, ["unknown"]));
    assert.throws(() => selectHighlights([items[0], items[0]], [items[0].id]));
});

test("非空自定义标记精确取值，不消费相似键或未标记段落", () => {
    assert.equal(highlightMarker('{: id="x" custom-clip-highlight="yellow"}'), "yellow");
    assert.equal(highlightMarker('{: custom-clip-highlight=""}'), "");
    assert.equal(highlightMarker('{: other-custom-clip-highlight="yellow"}'), "");
    assert.equal(highlightMarker('{: custom-clip-highlight-extra="yellow"}'), "");
    assert.equal(cleanHighlightText(" &nbsp;首行\r\n第二行\u00a0 "), "首行\n第二行");
});

test("Markdown 逐行转义纯文本引述，HTML、块引用、IAL 和链接不成为指令", () => {
    const selected = item(1, { text: "# 标题\n\n<script>alert(1)</script>\n[链接](javascript:evil)\n((块引用))\n{: custom-x=\"value\"}\n```\n$公式$", title: "[文章]\n# 标题", url: "javascript:evil" });
    const markdown = renderHighlightsMarkdown([selected], labels);
    assert.ok(markdown.includes("> \\# 标题\n> \n> &lt;script&gt;alert\\(1\\)&lt;/script&gt;"));
    assert.ok(markdown.includes("> \\[链接\\]\\(javascript:evil\\)"));
    assert.ok(markdown.includes("> \\(\\(块引用\\)\\)"));
    assert.ok(markdown.includes("> \\{: custom\\-x=\"value\"\\}"));
    assert.ok(markdown.includes("> \\`\\`\\`"));
    assert.ok(markdown.includes("> \\$公式\\$"));
    assert.ok(markdown.includes(`siyuan://blocks/${selected.id}`));
    assert.ok(markdown.includes(`siyuan://blocks/${rootId}`));
    assert.ok(!markdown.includes("来源网页:"));
    assert.ok(!markdown.includes(selected.markdown));
    assert.equal(escapeHighlightText("\\* & <"), "\\\\\\* &amp; &lt;");
});

test("合法来源原始 URL 保留，危险目标不作为 Markdown 链接", () => {
    const url = "https://example.test/article?one=1&two=2#part";
    assert.ok(renderHighlightsMarkdown([item(1, { url })], labels).includes(`](<${url}>)`));
    for (const invalid of ["javascript:evil", "https://example.test/\nunsafe", "https://example.test/<unsafe>", "https://example.test/\\unsafe"]) {
        assert.ok(!renderHighlightsMarkdown([item(1, { url: invalid })], labels).includes("来源网页:"));
    }
    assert.throws(() => highlightBlockLink("bad'ID"));
});

test("CSV 每个字段防公式注入，保留引号、逗号、多行与独立标签列", () => {
    for (const value of ["=SUM(1,2)", "+cmd", "-2+3", "@cmd", " \t=cmd", "\u0000@cmd", "\tplain", "\rplain", "\nplain"]) assert.ok(safeHighlightCsvCell(value).startsWith('"\''));
    assert.equal(safeHighlightCsvCell('正常,"文字"'), '"正常,""文字"""');
    const csv = renderHighlightsCsv([item(1, { title: "=cmd", text: '两行\n第二行,"引用"', tags: ["=user"], aiTags: ["@model"] })]);
    assert.ok(csv.includes('"userTags","aiTags"'));
    assert.ok(csv.includes('"\'=cmd"'));
    assert.ok(csv.includes('"\'=user","\'@model"'));
    assert.ok(csv.includes('"两行\n第二行,""引用"""'));
    assert.ok(csv.endsWith("\r\n"));
    assert.ok(csv.includes(`siyuan://blocks/${item(1).id}`));
});
