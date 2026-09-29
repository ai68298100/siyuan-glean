/** settings 兼容性单测（AI 开关细化轮） */
import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SETTINGS, normalizeSettings } from "../src/services/settings.ts";

test("normalizeSettings：旧版 enrichOnCapture=true → auto", () => {
    const normalized = normalizeSettings({
        version: 1,
        anchorNotebooks: [],
        ai: { enrichOnCapture: true },
    });
    assert.equal(normalized.ai.enrichMode, "auto");
    assert.equal(normalized.ai.enrichDailyCap, DEFAULT_SETTINGS.ai.enrichDailyCap);
    assert.equal(normalized.ai.dedupOnEnrich, true);
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
