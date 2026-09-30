/** domain/quotes 摘录投影纯函数单测（T-1750/T-1752） */
import test from "node:test";
import assert from "node:assert/strict";

import { filterQuotes, formatQuoteShare, quoteExportMarkdown, quoteFacets, type QuoteEntry } from "../src/domain/quotes.ts";

function entry(partial: Partial<QuoteEntry>): QuoteEntry {
    return {
        id: "20260101000000-aaaaaaa",
        rootId: "20260101000001-bbbbbbb",
        text: "一段摘录",
        title: "文章",
        site: "",
        tags: [],
        aiTags: [],
        ...partial,
    };
}

test("quoteFacets：站点/用户标签/AI 标签计数", () => {
    const facets = quoteFacets([
        entry({ site: "a.com", tags: ["阅读"], aiTags: ["AI"] }),
        entry({ site: "A.com", tags: ["阅读", "技术"], aiTags: ["AI"] }),
        entry({ tags: ["技术"] }),
    ]);
    assert.deepEqual(facets.sites, [{ name: "a.com", count: 2 }]);
    assert.deepEqual(facets.tags, [
        { name: "阅读", count: 2 },
        { name: "技术", count: 2 },
    ]);
    assert.deepEqual(facets.aiTags, [{ name: "AI", count: 2 }]);
    assert.deepEqual(quoteFacets([]).sites, []);
});

test("filterQuotes：站点/标签/关键词组合筛选（大小写不敏感）", () => {
    const items = [
        entry({ id: "q1", site: "a.com", tags: ["阅读"], text: "Hello World" }),
        entry({ id: "q2", site: "b.com", tags: ["技术"], text: "深度学习" }),
        entry({ id: "q3", aiTags: ["AI"], text: "hello again" }),
    ];
    assert.deepEqual(filterQuotes(items, { site: "A.COM" }).map((q) => q.id), ["q1"]);
    assert.deepEqual(filterQuotes(items, { tag: "技术" }).map((q) => q.id), ["q2"]);
    assert.deepEqual(filterQuotes(items, { aiTag: "ai" }).map((q) => q.id), ["q3"]);
    assert.deepEqual(filterQuotes(items, { keyword: "HELLO" }).map((q) => q.id), ["q1", "q3"]);
    assert.deepEqual(filterQuotes(items, {}).length, 3);
});

test("quoteExportMarkdown：逐条附原文回链", () => {
    const md = quoteExportMarkdown(
        [
            entry({ text: "多行 摘录 文本", title: "深度文章", site: "a.com", rootId: "20260101000001-bbbbbbb" }),
            entry({ text: "无站点摘录", title: "" }),
        ],
        "2026.10.01",
        "2026-10-01 12:00"
    );
    assert.ok(md.includes("# 摘录导出 · 2026.10.01"));
    assert.ok(md.includes("共 2 条摘录"));
    assert.ok(md.includes("siyuan://blocks/20260101000001-bbbbbbb"));
    assert.ok(md.includes("深度文章（a.com）"));
    assert.ok(md.includes("未命名文档"));
});

test("formatQuoteShare：引述 + 来源 + 回链（T-1803）", () => {
    const share = formatQuoteShare(entry({ text: "关键论点", title: "深度文章", site: "a.com", rootId: "20260101000001-bbbbbbb" }));
    assert.ok(share.includes("> 关键论点"));
    assert.ok(share.includes("—— 深度文章（a.com）"));
    assert.ok(share.includes("siyuan://blocks/20260101000001-bbbbbbb"));
    // 无站点时省略括号
    assert.ok(formatQuoteShare(entry({ text: "x", title: "文" })).includes("—— 文"));
});
