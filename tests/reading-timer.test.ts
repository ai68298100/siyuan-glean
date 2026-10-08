import test from "node:test";
import assert from "node:assert/strict";
import {
    advanceReadingTimer,
    canCountReading,
    createReadingTimer,
    readingTimerMinutes,
    setReadingTimerActive,
} from "../src/domain/reading-timer.ts";

test("reading timer accumulates only elapsed whole seconds and floors whole minutes", () => {
    let timer = createReadingTimer(2);
    timer = setReadingTimerActive(timer, true, 1_000);
    timer = advanceReadingTimer(timer, 91_999);
    assert.equal(timer.totalSeconds, 210);
    assert.equal(readingTimerMinutes(timer), 3);
    timer = setReadingTimerActive(timer, false, 121_999);
    assert.equal(timer.totalSeconds, 240);
    assert.equal(readingTimerMinutes(timer), 4);
});

test("reading timer ignores backwards/invalid timestamps and never counts while paused", () => {
    const paused = createReadingTimer(1);
    assert.deepEqual(advanceReadingTimer(paused, 50_000), paused);
    let active = setReadingTimerActive(paused, true, 10_000);
    active = advanceReadingTimer(active, 9_000);
    assert.equal(active.totalSeconds, 60);
    active = setReadingTimerActive(active, false, Number.NaN);
    assert.equal(active.totalSeconds, 60);
    assert.equal(active.activeSince, null);
});

test("reading eligibility requires visible focused rendered non-link content", () => {
    const base = { visible: true, focused: true, hostReady: true, contentType: "fulltext", bodyState: "ok" };
    assert.equal(canCountReading(base), true);
    assert.equal(canCountReading({ ...base, visible: false }), false);
    assert.equal(canCountReading({ ...base, focused: false }), false);
    assert.equal(canCountReading({ ...base, hostReady: false }), false);
    assert.equal(canCountReading({ ...base, contentType: "link" }), false);
    assert.equal(canCountReading({ ...base, bodyState: "missing" }), false);
});
