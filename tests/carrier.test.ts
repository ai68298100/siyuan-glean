import test from "node:test";
import assert from "node:assert/strict";
import { hasSourceAction, openTargetForCarrier, resolveCarrier, sourceUrlForCarrier } from "../src/domain/carrier.ts";

test("载体未知值不伪装成全文或链接", () => {
    assert.equal(resolveCarrier(undefined), "unknown");
    assert.equal(resolveCarrier("video"), "unknown");
    assert.equal(resolveCarrier("fulltext"), "fulltext");
});

test("全文和仅链接且为有效 http(s) 时提供来源次级动作", () => {
    assert.equal(sourceUrlForCarrier("link", " https://Example.com/a#part "), "https://Example.com/a#part");
    assert.equal(sourceUrlForCarrier("fulltext", "https://example.com/a"), "https://example.com/a");
    assert.equal(hasSourceAction("link", "https://example.com/a"), true);
    assert.equal(hasSourceAction("fulltext", "https://example.com/a"), true);
    assert.equal(openTargetForCarrier("link", "https://example.com/a"), "source");
    assert.equal(openTargetForCarrier("fulltext", "https://example.com/a"), "document");
});

test("本地文档和无效来源始终打开思源文档", () => {
    assert.equal(hasSourceAction("local", "https://example.com/a"), false);
    assert.equal(hasSourceAction("link", "javascript:alert(1)"), false);
    assert.equal(openTargetForCarrier("link", ""), "document");
});
