import test from "node:test";
import assert from "node:assert/strict";
import { estimateReadingPercentage, estimateReadingRatio, parseReadingPosition, serializeReadingPosition } from "../src/domain/reading-position.ts";

const position = { version: 1, blockId: "20261004120000-aaaaaaa", offset: 125, at: "2026-10-04T04:00:00.000Z" } as const;

test("阅读位置可从对象和 JSON 读取并按契约序列化，返回独立对象", () => {
    assert.deepEqual(parseReadingPosition(position), position);
    assert.deepEqual(parseReadingPosition(JSON.stringify(position)), position);
    assert.notEqual(parseReadingPosition(position), position);
    assert.equal(serializeReadingPosition(position), JSON.stringify(position));
});

test("位置版本、字段集合、块 ID 和偏移严格校验", () => {
    for (const patch of [
        { version: 2 }, { version: "1" }, { blockId: "bad-id" }, { blockId: "20261004120000-AAAAAAA" },
        { offset: -1 }, { offset: 10001 }, { offset: 1.5 }, { offset: "125" }, { offset: NaN }, { offset: Infinity },
        { extra: true }, { at: undefined },
    ]) assert.equal(parseReadingPosition({ ...position, ...patch }), null, JSON.stringify(patch));
    assert.deepEqual(parseReadingPosition({ ...position, offset: 0 }), { ...position, offset: 0 });
    assert.deepEqual(parseReadingPosition({ ...position, offset: 10000 }), { ...position, offset: 10000 });
    for (const raw of [null, undefined, 1, [], {}, "", "bad json", "null", "[]", " ".repeat(1025)]) assert.equal(parseReadingPosition(raw), null);
});

test("时间必须是可往返的真实 UTC ISO 时间，拒绝日期自动进位和偏移时区", () => {
    for (const at of ["2026-02-29T04:00:00.000Z", "2026-02-31T04:00:00.000Z", "2026-10-04T24:00:00.000Z", "2026-10-04T04:00:00Z", "2026-10-04T04:00:00.000+00:00", "2026-10-04", "invalid"]) {
        assert.equal(parseReadingPosition({ ...position, at }), null, at);
    }
    assert.ok(parseReadingPosition({ ...position, at: "2024-02-29T23:59:59.999Z" }));
});

test("非法位置不能序列化，不以默认位置掩盖非法旧值", () => {
    assert.throws(() => serializeReadingPosition({ ...position, offset: 10001 }), RangeError);
    assert.throws(() => serializeReadingPosition("legacy bookmark"), RangeError);
    assert.throws(() => serializeReadingPosition(null), RangeError);
});

test("estimateReadingRatio & estimateReadingPercentage：在真实滚动视口下轻量估算百分比，短文与非法值返回 null（T-3336 / T-3380）", () => {
    // 1. 正常长文视口（总高 1000px，视口 200px）
    // 刚打开在顶部：读到 200/1000 = 20%
    assert.equal(estimateReadingPercentage(0, 1000, 200), 20);
    // 滚动到 400px：读到 (400+200)/1000 = 60%
    assert.equal(estimateReadingPercentage(400, 1000, 200), 60);
    // 滚动到底部 800px：读到 1000/1000 = 100%
    assert.equal(estimateReadingPercentage(800, 1000, 200), 100);

    // 2. 无溢出短文（内容高度 <= 视口高度）：不伪造百分比，返回 null
    assert.equal(estimateReadingPercentage(0, 300, 300), null);
    assert.equal(estimateReadingPercentage(0, 150, 400), null);

    // 3. 非法数值边界：安全返回 null
    assert.equal(estimateReadingPercentage(0, 0, 0), null);
    assert.equal(estimateReadingPercentage(Number.NaN, 1000, 200), null);
});
