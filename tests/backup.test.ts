/** domain/backup 备份包纯函数单测（T-1780，契约 DATA-CONTRACT §0.1） */
import test from "node:test";
import assert from "node:assert/strict";

import { BACKUP_APP, BACKUP_VERSION, backupFileName, parseBackup, pickClipAttrs, previewBackup } from "../src/domain/backup.ts";
import { ATTR } from "../src/domain/schema.ts";

test("pickClipAttrs：只保留 custom-clip-* 字符串键", () => {
    const picked = pickClipAttrs({
        [ATTR.status]: "inbox",
        tags: "用户标签不进包",
        custom: "不是 clip 前缀",
        [ATTR.priority]: "3",
        empty: undefined,
    });
    assert.deepEqual(picked, { [ATTR.status]: "inbox", [ATTR.priority]: "3" });
});

test("parseBackup：合法包通过并丢弃非法键；坏包整体拒绝", () => {
    const pkg = {
        version: BACKUP_VERSION,
        app: BACKUP_APP,
        exportedAt: "2026-10-01T00:00:00.000Z",
        settings: { anchorNotebooks: ["box"] },
        index: { clips: {} },
        uiPrefs: { lastView: "stats" },
        clips: [
            { id: "20260101000000-abcdefg", attrs: { [ATTR.status]: "inbox", rogue: "x" } },
            { id: "", attrs: {} }, // 空 ID 丢弃
            { id: "20260101000001-abcdefg" }, // 无 attrs 丢弃
        ],
    };
    const parsed = parseBackup(JSON.stringify(pkg));
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
        assert.equal(parsed.data.clips.length, 1);
        assert.equal(parsed.data.clips[0].attrs[ATTR.status], "inbox");
        assert.equal("rogue" in parsed.data.clips[0].attrs, false);
        assert.notEqual(parsed.data.settings, null);
    }

    assert.equal(parseBackup("not json").ok, false);
    assert.equal(parseBackup("[]").ok, false);
    assert.equal(parseBackup(JSON.stringify({ ...pkg, version: 99 })).ok, false);
    assert.equal(parseBackup(JSON.stringify({ ...pkg, app: "other" })).ok, false);
    assert.equal(parseBackup(JSON.stringify({ ...pkg, clips: "x" })).ok, false);
});

test("previewBackup：按缺失集统计可恢复/缺失", () => {
    const parsed = parseBackup(JSON.stringify({
        version: BACKUP_VERSION,
        app: BACKUP_APP,
        exportedAt: "",
        settings: null,
        index: null,
        uiPrefs: null,
        clips: [
            { id: "20260101000000-abcdefg", attrs: {} },
            { id: "20260101000001-abcdefg", attrs: {} },
            { id: "20260101000002-abcdefg", attrs: {} },
        ],
    }));
    assert.ok(parsed.ok);
    if (parsed.ok) {
        const preview = previewBackup(parsed.data, new Set(["20260101000001-abcdefg"]));
        assert.deepEqual(preview, {
            totalClips: 3, restorable: 2, missing: 1,
            restoresSettings: false, restoresIndex: false, restoresPrefs: false,
        });
    }
});

test("backupFileName：时间戳命名", () => {
    assert.match(backupFileName(new Date(2026, 9, 1, 8, 5, 3)), /^glean-backup-20261001-080503\.json$/);
});
