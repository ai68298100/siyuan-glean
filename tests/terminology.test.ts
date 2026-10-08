import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const zh = JSON.parse(readFileSync(resolve(root, "public/i18n/zh_CN.json"), "utf8")) as Record<string, string>;
const en = JSON.parse(readFileSync(resolve(root, "public/i18n/en_US.json"), "utf8")) as Record<string, string>;
const glossary = readFileSync(resolve(root, "docs/TERMINOLOGY.md"), "utf8");

test("术语表覆盖状态、候选依据和今日拾遗动作", () => {
    for (const term of ["inbox", "later", "reading", "done", "archived", "candidate", "source evidence", "resurface", "defer", "undo", "offline", "retry"]) {
        assert.ok(glossary.toLowerCase().includes(term.toLowerCase()), `术语表缺少 ${term}`);
    }
});

test("中英文 UI 状态和动作使用统一自然语言", () => {
    assert.equal(zh["queue.inbox"], "待分拣");
    assert.equal(zh["status.done"], "已读");
    assert.equal(en["status.done"], "Finished");
    assert.equal(zh["candidate.pending"], "待确认");
    assert.equal(en["candidate.pending"], "Needs review");
    assert.equal(zh["view.resurface"], "今日拾遗");
    assert.equal(en["view.resurface"], "Today's gleaning");
});

test("移动端离线、失败、重试和撤销文案保留可操作语义", () => {
    assert.match(zh["mobile.offlineHint"], /仍可查看/);
    assert.match(en["mobile.offlineHint"], /Existing content remains available/);
    assert.match(zh["msg.statusFailed"], /失败/);
    assert.match(en["msg.statusFailed"], /retry/i);
    assert.match(zh["resurface.undoUnavailable"], /状态已变化|无法撤销/);
    assert.match(en["resurface.undoUnavailable"], /changed|cannot be undone/i);
});

test("不会把历史里程碑或错误单位暴露给用户", () => {
    assert.doesNotMatch(zh["ai.actionsPreview"], /M3/);
    assert.doesNotMatch(en["ai.actionsPreview"], /coming in M3/i);
    assert.equal(en["stats.wan"], "×10k");
    assert.notEqual(en["stats.wan"], "0k");
    assert.equal(en["stats.doneUnit"], "articles");
});
