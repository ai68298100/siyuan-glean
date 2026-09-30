/** S2 候选资格：一库混有正文、剪藏、长标签和插件宿主时不误收录。 */
import test from "node:test";
import assert from "node:assert/strict";

import { inspectCandidate } from "../src/domain/candidate-policy.ts";
import { applyAttrsToIndex, emptyIndex } from "../src/services/index-store.ts";

const meta = (id: string, hpath = `/${id}`) => ({
    id,
    title: id,
    hpath,
    box: "reading-notebook",
    updated: "20260929120000",
});

test("混合笔记本只列有精确来源证据的未收录文档", () => {
    const index = emptyIndex();
    applyAttrsToIndex(index, meta("ordinary"), {});
    applyAttrsToIndex(index, meta("long-tag"), { tags: "剪藏技巧,随笔" });
    applyAttrsToIndex(index, meta("inline-link"), {}, inspectCandidate({
        ial: {},
        markdown: "# 随笔\n\n这个项目见 [官网](https://example.com)。",
    }));
    applyAttrsToIndex(index, meta("url-only"), { "custom-clip-url": "https://example.com/old" });
    applyAttrsToIndex(index, meta("tag-only", "/跨本/tag-only"), { tags: "工作, #剪藏" });
    applyAttrsToIndex(index, meta("template"), {}, inspectCandidate({
        ial: {},
        markdown: "## 官方剪藏\n\n- [https://example.com/Post](https://example.com/Post)\n\n正文",
    }));

    assert.deepEqual(Object.keys(index.candidates).sort(), ["tag-only", "template", "url-only"]);
    assert.deepEqual(index.candidates["url-only"].evidence, ["url-attribute"]);
    assert.equal(index.candidates["url-only"].url, "https://example.com/old");
    assert.deepEqual(index.candidates["tag-only"].missing, ["url", "status"]);
    assert.deepEqual(index.candidates.template.evidence, ["clipper-template"]);
});

test("误报标记和插件宿主不入候选；已收录的同名文档仍留库", () => {
    const index = emptyIndex();
    applyAttrsToIndex(index, meta("excluded"), {
        "custom-clip-url": "https://example.com/false-positive",
        "custom-clip-excluded": "true",
    });
    applyAttrsToIndex(index, meta("weekly", "/读库周报/20260923-20260929"), { tags: "剪藏" });
    applyAttrsToIndex(index, meta("marked-internal"), {
        "custom-clip-url": "https://example.com/internal",
        "custom-clip-internal": "true",
    });
    applyAttrsToIndex(index, {
        ...meta("library", "/读库数据库"), title: "读库数据库",
    }, { tags: "剪藏" });
    applyAttrsToIndex(index, {
        ...meta("library-article", "/读库数据库"), title: "读库数据库",
    }, { "custom-clip-status": "later", "custom-clip-url": "https://example.com/valid" });

    assert.deepEqual(Object.keys(index.candidates), []);
    assert.equal(index.clips["library-article"].status, "later");
});

test("完整标签匹配不相信 SQL LIKE 命中，来源行仅在正文开头独立成行时识别", () => {
    assert.equal(inspectCandidate({ ial: { tags: "剪藏技巧" }, tagged: true }).eligible, false);
    assert.equal(inspectCandidate({ ial: { tags: "工作,#剪藏,阅读" } }).eligible, true);
    assert.equal(inspectCandidate({ ial: {}, tags: "#剪藏 #研究" }).eligible, true);
    assert.equal(inspectCandidate({ ial: {}, markdown: "# 普通笔记\n\n正文见 https://example.com" }).eligible, false);
    const standalone = inspectCandidate({ ial: {}, markdown: "# 收藏\n\nhttps://example.com/article\n\n正文" });
    assert.equal(standalone.eligible, true);
    assert.deepEqual(standalone.evidence, ["source-line"]);
    assert.equal(standalone.url, "https://example.com/article");
    const late = inspectCandidate({ ial: {}, markdown: `${"正文\n".repeat(12)}https://example.com/late` });
    assert.equal(late.eligible, false);
});

test("思源导出的 YAML 前言不挤掉剪藏模板链接", () => {
    const markdown = [
        "---", "title: 示例", "date: 2026-09-29", "lastmod: 2026-09-29", "---", "",
        "# 示例", "", "- [https://example.com/post](https://example.com/post)", "正文",
    ].join("\n");
    const result = inspectCandidate({ markdown });
    assert.equal(result.eligible, true);
    assert.equal(result.url, "https://example.com/post");
});

test("D-0032：归档/回收宿主路径段豁免候选扫描（宿主与其子文档均不误收）", () => {
    const markdown = "# 收藏\n\nhttps://example.com/article\n\n正文";
    const archived = inspectCandidate({ markdown, hpath: "/收集/【归档】/深度文章" });
    assert.equal(archived.internal, true);
    assert.equal(archived.eligible, false);
    const recycled = inspectCandidate({ markdown, hpath: "/收集/【回收】/深度文章" });
    assert.equal(recycled.internal, true);
    assert.equal(recycled.eligible, false);
    // 宿主文档本身（路径段即标题，无 URL 证据）同样豁免
    const host = inspectCandidate({ title: "【归档】", hpath: "/收集/【归档】" });
    assert.equal(host.internal, true);
    // 普通文章不受影响
    const normal = inspectCandidate({ markdown, hpath: "/收集/普通文章" });
    assert.equal(normal.internal, false);
    assert.equal(normal.eligible, true);
});

