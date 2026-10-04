import test from "node:test";
import assert from "node:assert/strict";
import {
    advanceFlashcardRecovery, createFlashcardRecovery, parseFlashcardRecovery,
} from "../src/domain/flashcard-recovery.ts";

const now = new Date("2026-10-05T08:00:00.000Z");
const recovery = createFlashcardRecovery("test-deck", "20261004120000-aaaaaaa", "20261004120000-bbbbbbb", now);

test("制卡恢复检查点只保存阶段、ID和时间，不携带正文", () => {
    assert.equal(recovery.phase, "insert-intent");
    assert.equal(recovery.createdAt, recovery.updatedAt);
    assert.doesNotMatch(JSON.stringify(recovery), /正文|引文|模型|secret|front|back/);
    assert.deepEqual(parseFlashcardRecovery(JSON.stringify(recovery)), recovery);
});

test("制卡恢复阶段只能向前推进且严格校验节点 ID", () => {
    const inserted = advanceFlashcardRecovery(recovery, "inserted", new Date("2026-10-05T08:01:00.000Z"));
    const registered = advanceFlashcardRecovery(inserted, "registered", new Date("2026-10-05T08:02:00.000Z"));
    assert.equal(registered.phase, "registered");
    assert.throws(() => advanceFlashcardRecovery(registered, "inserted"));
    assert.throws(() => parseFlashcardRecovery({ ...recovery, cardBlockId: "recent-card" }));
    assert.throws(() => parseFlashcardRecovery({ ...recovery, phase: "unknown" }));
});

