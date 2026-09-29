/** domain/checkin 纯函数单测（T-1505 externalRef 幂等身份） */
import test from "node:test";
import assert from "node:assert/strict";

import { localDate, readingEventNote, readingEventRef } from "../src/domain/checkin.ts";

const NOW = new Date(2026, 8, 29, 12, 0, 0); // 2026-09-29

test("localDate：本地日 YYYY-MM-DD", () => {
    assert.equal(localDate(NOW), "2026-09-29");
});

test("readingEventRef：同文档同日恒定（幂等身份）", () => {
    const a = readingEventRef("20260901-aaaaaaa", NOW);
    const b = readingEventRef("20260901-aaaaaaa", new Date(2026, 8, 29, 23, 59, 59));
    assert.equal(a, "glean:20260901-aaaaaaa:2026-09-29");
    assert.equal(a, b);
});

test("readingEventRef：跨日变化", () => {
    assert.equal(readingEventRef("20260901-aaaaaaa", new Date(2026, 8, 30, 0, 1, 0)), "glean:20260901-aaaaaaa:2026-09-30");
});

test("readingEventNote：有标题/无标题", () => {
    assert.equal(readingEventNote("深度文章"), "小驴拾遗：读完《深度文章》");
    assert.equal(readingEventNote(""), "小驴拾遗：读完一篇重浮文章");
});
