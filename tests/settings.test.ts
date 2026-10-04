/** settings 兼容性单测（AI 开关细化轮） */
import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SETTINGS, cloneSettings, mergeSettingsDraft, normalizeSettings, settingsEqual } from "../src/services/settings.ts";

test("normalizeSettings：旧版 enrichOnCapture=true → auto", () => {
    const normalized = normalizeSettings({
        version: 1,
        anchorNotebooks: [],
        ai: { enrichOnCapture: true },
    });
    assert.equal(normalized.ai.enrichMode, "auto");
    assert.equal(normalized.ai.enrichDailyCap, DEFAULT_SETTINGS.ai.enrichDailyCap);
    assert.equal(normalized.ai.dedupOnEnrich, false);
});

test("normalizeSettings：旧版 enrichOnCapture=false → manual", () => {
    const normalized = normalizeSettings({ ai: { enrichOnCapture: false } });
    assert.equal(normalized.ai.enrichMode, "manual");
});

test("normalizeSettings：新三态直读，非法值回退默认", () => {
    assert.equal(normalizeSettings({ ai: { enrichMode: "off" } }).ai.enrichMode, "off");
    assert.equal(normalizeSettings({ ai: { enrichMode: "auto" } }).ai.enrichMode, "auto");
    assert.equal(normalizeSettings({ ai: { enrichMode: "bogus" } }).ai.enrichMode, DEFAULT_SETTINGS.ai.enrichMode);
    assert.equal(normalizeSettings({ ai: {} }).ai.enrichMode, DEFAULT_SETTINGS.ai.enrichMode);
});

test("normalizeSettings：每日上限钳制 0-500", () => {
    assert.equal(normalizeSettings({ ai: { enrichDailyCap: -5 } }).ai.enrichDailyCap, 0);
    assert.equal(normalizeSettings({ ai: { enrichDailyCap: 9999 } }).ai.enrichDailyCap, 500);
    assert.equal(normalizeSettings({ ai: { enrichDailyCap: 10 } }).ai.enrichDailyCap, 10);
});

test("默认富化模式=manual（token 消耗需用户显式开启自动）", () => {
    assert.equal(DEFAULT_SETTINGS.ai.enrichMode, "manual");
    assert.equal(DEFAULT_SETTINGS.ai.enrichDailyCap > 0, true);
});

test("自动快照默认关闭，只保留明确布尔选择", () => {
    assert.equal(DEFAULT_SETTINGS.snapshotOnCapture, false);
    assert.equal(normalizeSettings({}).snapshotOnCapture, false);
    for (const value of [undefined, null, "true", "false", 1, 0, {}, []]) {
        assert.equal(normalizeSettings({ snapshotOnCapture: value }).snapshotOnCapture, false);
    }
    assert.equal(normalizeSettings({ snapshotOnCapture: true }).snapshotOnCapture, true);
    assert.equal(normalizeSettings({ snapshotOnCapture: false }).snapshotOnCapture, false);
});

test("自动快照参与设置草稿克隆、修改检测、保存与重置", () => {
    const current = normalizeSettings({ migrateBatchSize: 37 });
    const draft = cloneSettings(current);
    draft.snapshotOnCapture = true;
    assert.equal(current.snapshotOnCapture, false);
    assert.equal(settingsEqual(current, draft), false);
    assert.equal(cloneSettings(draft).snapshotOnCapture, true);
    const merged = mergeSettingsDraft(current, draft);
    assert.equal(merged.snapshotOnCapture, true);
    assert.equal(merged.migrateBatchSize, 37);
    assert.equal(mergeSettingsDraft(merged, cloneSettings(DEFAULT_SETTINGS)).snapshotOnCapture, false);
});

test("AI 功能新用户默认关闭，保留显式布尔选择而拒绝类型漂移", () => {
    const fields = ["dedupOnEnrich", "relatedWhileReading", "presetActions", "formattingEnabled"] as const;
    for (const field of fields) {
        assert.equal(DEFAULT_SETTINGS.ai[field], false);
        assert.equal(normalizeSettings({}).ai[field], false);
        assert.equal(normalizeSettings({ ai: { [field]: true } }).ai[field], true);
        assert.equal(normalizeSettings({ ai: { [field]: false } }).ai[field], false);
        for (const value of ["true", "false", 1, 0, {}, [], null]) {
            assert.equal(normalizeSettings({ ai: { [field]: value } }).ai[field], false);
        }
    }
});

test("normalizeSettings：reader 组默认关且非法模式回退 read（D-0029）", () => {
    const missing = normalizeSettings({});
    assert.equal(missing.reader.openInTab, false);
    assert.equal(missing.reader.defaultMode, "read");
    const custom = normalizeSettings({ reader: { openInTab: true, defaultMode: "edit" } });
    assert.equal(custom.reader.openInTab, true);
    assert.equal(custom.reader.defaultMode, "edit");
    const invalid = normalizeSettings({ reader: { openInTab: "yes", defaultMode: "wysiwyg" } });
    assert.equal(invalid.reader.openInTab, DEFAULT_SETTINGS.reader.openInTab);
    assert.equal(invalid.reader.defaultMode, "read");
});

test("设置草稿：克隆不会共享嵌套数组或对象", () => {
    const draft = cloneSettings(DEFAULT_SETTINGS);
    draft.anchorNotebooks.push("notebook-1");
    draft.ai.customBaseUrl = "https://example.test/v1";
    assert.deepEqual(DEFAULT_SETTINGS.anchorNotebooks, []);
    assert.equal(DEFAULT_SETTINGS.ai.customBaseUrl, "");
});

test("设置草稿：相同内容相等，嵌套改动可识别", () => {
    const draft = cloneSettings(DEFAULT_SETTINGS);
    assert.equal(settingsEqual(DEFAULT_SETTINGS, draft), true);
    draft.reader.defaultMode = "edit";
    assert.equal(settingsEqual(DEFAULT_SETTINGS, draft), false);
});

test("设置草稿：提交时保留编辑期间由其他流程更新的迁移批大小", () => {
    const current = normalizeSettings({ migrateBatchSize: 37 });
    const draft = cloneSettings(DEFAULT_SETTINGS);
    draft.anchorNotebooks = ["notebook-1"];
    const merged = mergeSettingsDraft(current, draft);
    assert.deepEqual(merged.anchorNotebooks, ["notebook-1"]);
    assert.equal(merged.migrateBatchSize, 37);
});

test("桥接写开关默认关闭，只有布尔 true 能开启", () => {
    assert.equal(DEFAULT_SETTINGS.integration.bridgeWriteEnabled, false);
    assert.equal(normalizeSettings({}).integration.bridgeWriteEnabled, false);
    for (const value of [undefined, null, "true", "false", 1, 0, {}, []]) {
        assert.equal(normalizeSettings({ integration: { bridgeWriteEnabled: value } }).integration.bridgeWriteEnabled, false);
    }
    assert.equal(normalizeSettings({ integration: { bridgeWriteEnabled: true } }).integration.bridgeWriteEnabled, true);
    assert.equal(normalizeSettings({ integration: { bridgeWriteEnabled: false } }).integration.bridgeWriteEnabled, false);
});

test("桥接写开关参与草稿克隆、修改检测、提交与重置", () => {
    const current = normalizeSettings({ integration: { checkinEnabled: true, checkinItemId: "reading" }, migrateBatchSize: 37 });
    const draft = cloneSettings(current);
    draft.integration.bridgeWriteEnabled = true;
    assert.equal(current.integration.bridgeWriteEnabled, false);
    assert.equal(settingsEqual(current, draft), false);
    const merged = mergeSettingsDraft(current, draft);
    assert.equal(merged.integration.bridgeWriteEnabled, true);
    assert.equal(merged.integration.checkinEnabled, true);
    assert.equal(merged.integration.checkinItemId, "reading");
    assert.equal(merged.migrateBatchSize, 37);
    assert.equal(mergeSettingsDraft(merged, cloneSettings(DEFAULT_SETTINGS)).integration.bridgeWriteEnabled, false);
});
