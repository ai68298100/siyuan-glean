import test from "node:test";
import assert from "node:assert/strict";
import { csvCell, renderLibraryCsv } from "../src/domain/library-export.ts";
import { articleMarkdownFilename, buildStoredZip, renderArticleMarkdown } from "../src/domain/markdown-export.ts";

test("library CSV keeps unknown values empty and protects formulas", () => {
    assert.equal(csvCell("=SUM(A1)"), "'=SUM(A1)");
    const csv = renderLibraryCsv([{
        id: "id", title: "=title", path: "", notebook: "", status: "inbox", url: "https://x",
        site: "", author: "=Author", time: "", doneTime: "", words: "", minutes: "", readMinutes: "", priority: "", rating: "",
        source: "", contentType: "", timeSource: "", lastSurfaced: "", pinned: "20260929", userTags: [], aiTags: [], summary: "", snapshot: "",
    }]);
    assert.match(csv, /'=title/);
    assert.match(csv, /site,author,time/);
    assert.match(csv, /'=Author/);
    assert.match(csv, /inbox/);
    assert.match(csv, /lastSurfaced,pinned/);
    assert.match(csv, /words,minutes,readMinutes,priority/);
    assert.match(csv, /20260929/);
});

test("Markdown article export keeps an allowlisted metadata frontmatter and body", () => {
    const meta = {
        id: "20261004120000-aaaaaaa", title: "标题\n注入", path: "/读库/标题", notebook: "box", status: "inbox",
        url: "https://example.test/a", site: "站点", author: "作者", time: "20261004120000", doneTime: "",
        source: "manual", contentType: "fulltext", tags: ["用户标签"], aiTags: ["AI"], summary: "摘要",
    };
    const markdown = renderArticleMarkdown(meta, "正文\n\n- 列表");
    assert.equal(articleMarkdownFilename(meta), "标题-注入-20261004120000-aaaaaaa.md");
    assert.match(markdown, /^---\ntitle: "标题 注入"/);
    assert.match(markdown, /id: "20261004120000-aaaaaaa"/);
    assert.match(markdown, /\n# 标题 注入\n/);
    assert.match(markdown, /正文\n\n- 列表/);
    assert.doesNotMatch(markdown, /custom-clip-/);
});

test("stored ZIP can be decoded by its central directory", () => {
    const zip = buildStoredZip([{ name: "index.json", content: "{}\n" }, { name: "articles/a.md", content: "# A\n" }]);
    const bytes = new Uint8Array(zip);
    assert.equal(String.fromCharCode(...bytes.slice(0, 4)), "PK\x03\x04");
    const end = bytes.length - 22;
    assert.equal(String.fromCharCode(...bytes.slice(end, end + 4)), "PK\x05\x06");
    assert.equal(bytes[end + 10] | (bytes[end + 11] << 8), 2);
});
