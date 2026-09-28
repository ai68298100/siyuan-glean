/** domain/migrate 启发式单测 */
import test from "node:test";
import assert from "node:assert/strict";

import { bestUrlCandidate, extractUrlCandidates, stripMarkdown } from "../src/domain/migrate.ts";
import { DEFAULT_MIGRATE_BATCH_SIZE, MAX_MIGRATE_BATCH_SIZE } from "../src/domain/migrate-consts.ts";

test("官方剪藏默认模板形态：第二行链接行得分最高", () => {
    const markdown = [
        "## 一篇剪藏的文章",
        "",
        "- [https://example.com/post/1](https://example.com/post/1)",
        "",
        "正文引用了 [另一个站](https://other.com/x)。",
    ].join("\n");
    const best = bestUrlCandidate(markdown);
    assert.ok(best);
    assert.equal(best.url, "https://example.com/post/1");
    assert.equal(best.reason, "clipper-template-link");
});

test("裸 URL 行识别", () => {
    const best = bestUrlCandidate("标题\n\nhttps://kernel.org/news\n\n正文");
    assert.ok(best);
    assert.equal(best.url, "https://kernel.org/news");
    assert.equal(best.reason, "bare-url-line");
});

test("无候选返回 null；非 http 链接忽略", () => {
    assert.equal(bestUrlCandidate("没有链接的一篇文档"), null);
    assert.equal(bestUrlCandidate("[本地](file:///a.md)"), null);
});

test("尾随标点被清理", () => {
    const [first] = extractUrlCandidates("https://example.com/a.");
    assert.equal(first.url, "https://example.com/a");
});

test("stripMarkdown：代码块/图片/链接/标题标记移除", () => {
    const stripped = stripMarkdown("# 标题\n\n![](img.png)\n\n[链接](https://x)\n\n```js\ncode()\n```\n\n- 列表项");
    assert.ok(!stripped.includes("code()"));
    assert.ok(!stripped.includes("img.png"));
    assert.ok(stripped.includes("链接"));
    assert.ok(stripped.includes("标题"));
});

test("批量约束：默认 25，上限 50（规划书 T-1102）", () => {
    assert.equal(DEFAULT_MIGRATE_BATCH_SIZE, 25);
    assert.equal(MAX_MIGRATE_BATCH_SIZE, 50);
});
