import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

 test("情境选文面板接入今日拾遗并保持纯投影边界", () => {
    const panel = read("src/ui/ContextSelectionPanel.svelte");
    const resurface = read("src/ui/ResurfaceView.svelte");
    assert.match(panel, /facade: GleanFacade/);
    assert.match(panel, /index: GleanIndex/);
    assert.match(panel, /currentTime: Date/);
    assert.match(panel, /selectReadingContext\(items/);
    assert.match(panel, /ageDays\(item\.time, currentTime\)/);
    assert.match(panel, /CONTEXT_BUDGETS/);
    assert.match(panel, /includeDone/);
    assert.match(panel, /includeUnknownMinutes/);
    assert.match(panel, /facade\.openReadingDocument\(candidate\.item\.id\)/);
    assert.match(panel, /context\.empty\./);
    assert.match(panel, /window\.open\(url, "_blank", "noopener,noreferrer"\)/);
    assert.doesNotMatch(panel, new RegExp("saveData|setBlockAttrs|/api/"));
    assert.match(resurface, /import ContextSelectionPanel from "\.\/ContextSelectionPanel\.svelte"/);
    assert.match(resurface, /<ContextSelectionPanel \{facade\} \{index\} \{currentTime\} \/>/);
});

test("情境选文面板有双语筛选、理由和打开文案", () => {
    const zh = JSON.parse(read("public/i18n/zh_CN.json")) as Record<string, string>;
    const en = JSON.parse(read("public/i18n/en_US.json")) as Record<string, string>;
    const keys = [
        "context.title", "context.budget", "context.tag", "context.includeDone", "context.includeUnknownMinutes",
        "context.resultCount", "context.results", "context.reasons", "context.open", "context.empty.title",
        "context.reason.budget", "context.reason.tag", "context.reason.priority", "context.reason.waiting",
        "context.reason.unknownMinutes", "context.reason.linkOnly", "context.empty.noMatch",
    ];
    for (const key of keys) {
        assert.equal(typeof zh[key], "string", `zh 缺少 ${key}`);
        assert.equal(typeof en[key], "string", `en 缺少 ${key}`);
    }
});
