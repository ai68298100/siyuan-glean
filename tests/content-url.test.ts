import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUrl } from "../src/domain/url.ts";
import { fulltextBodyState, inspectClipMarkdown } from "../src/domain/content.ts";
import { documentTimeFromId, parseClipAttrs, serializePatch, ATTR } from "../src/domain/schema.ts";

test("URL 查重键只规范协议/主机、默认端口、fragment 和非根路径尾斜杠", () => {
    assert.equal(normalizeUrl(" HTTPS://EXAMPLE.COM:443/Article/?q=One#section "), "https://example.com/Article?q=One");
    assert.equal(normalizeUrl("http://Example.com:80/"), "http://example.com/");
    assert.equal(normalizeUrl("https://example.com/A?q=1&x=2"), "https://example.com/A?q=1&x=2");
    assert.notEqual(normalizeUrl("https://example.com/A"), normalizeUrl("https://example.com/a"));
    assert.equal(normalizeUrl("javascript:alert(1)"), "");
    assert.equal(normalizeUrl("garbage"), "");
});

test("正文统计不把标题、来源链接、导入说明当成全文", () => {
    const link = "# 文章标题\n\n- [https://Example.com/A](https://Example.com/A)\n- 来源：Example.com\n- 收藏于：2026-09-29\n\n> 由迁移导入器带入。原文内容请访问来源链接。";
    const onlyLink = inspectClipMarkdown(link);
    assert.deepEqual(onlyLink, {
        url: "https://Example.com/A", site: "example.com", words: 0, minutes: 0, contentType: "link",
    });
    const full = inspectClipMarkdown(`${link}\n\n正文内容 Hello world。`);
    assert.equal(full.contentType, "fulltext");
    assert.equal(full.words, 6);
    assert.equal(full.minutes, 1);
    assert.equal(inspectClipMarkdown("# 本地文档\n\n三行正文").contentType, "local");
});

test("旧时间来源呈 legacy，新时间来源与内容类型可序列化；文档 ID 时间须有效", () => {
    assert.equal(parseClipAttrs({ [ATTR.time]: "20240102030405" }).timeSource, "legacy");
    assert.deepEqual(serializePatch({ timeSource: "document", contentType: "fulltext", excluded: true }), {
        [ATTR.timeSource]: "document", [ATTR.contentType]: "fulltext", [ATTR.excluded]: "true",
    });
    assert.equal(documentTimeFromId("20240102030405-abcd123"), "20240102030405");
    assert.equal(documentTimeFromId("20240230030405-abcd123"), null);
    assert.equal(documentTimeFromId("invalid"), null);
});

test("fulltextBodyState：只按已记录测量判断，不猜测（T-1727）", () => {
    assert.equal(fulltextBodyState("fulltext", 120), "ok");
    assert.equal(fulltextBodyState("fulltext", 0), "missing");
    assert.equal(fulltextBodyState("fulltext", undefined), "unmeasured");
    assert.equal(fulltextBodyState("link", 0), "na");
    assert.equal(fulltextBodyState("local", 50), "na");
    assert.equal(fulltextBodyState(undefined, 0), "na");
});

test("done-time 属性可解析与序列化；删除传 null（D-0028）", () => {
    assert.deepEqual(serializePatch({ doneTime: "20260930120000" }), { [ATTR.doneTime]: "20260930120000" });
    assert.deepEqual(serializePatch({ doneTime: null }), { [ATTR.doneTime]: null });
    const attrs = parseClipAttrs({ [ATTR.doneTime]: "20260930120000" });
    assert.equal(attrs.doneTime, "20260930120000");
    assert.equal(parseClipAttrs({}).doneTime, undefined);
});
