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

test("情境选文按内容容器适配窄 Dock 并允许长内容换行", () => {
    const panel = read("src/ui/ContextSelectionPanel.svelte");
    const styles = panel.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
    const compact = styles.slice(styles.indexOf("@container glean-content (max-width: 560px)"));
    assert.match(compact, /\.glean-context-selection__item\s*\{[^}]*flex-direction:\s*column/);
    assert.match(compact, /\.glean-context-selection__open\s*\{[^}]*min-height:\s*44px/);
    assert.doesNotMatch(styles, /@media\s*\(max-width:/);
    assert.match(styles, /\.glean-context-selection__field select\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*box-sizing:\s*border-box/);
    assert.match(styles, /\.glean-context-selection__item-title\s*\{[^}]*overflow-wrap:\s*anywhere/);
    assert.match(styles, /\.glean-context-selection__check span\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere/);
    assert.match(styles, /\.glean-context-selection__reasons \.glean-chip\s*\{[^}]*max-width:\s*100%;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere/);
});

test("预算控件与数字选项类型一致，长面板保留今日卡片的自然高度", () => {
    const panel = read("src/ui/ContextSelectionPanel.svelte");
    const styles = read("src/index.scss");
    assert.match(panel, /<select aria-label=\{t\(i18n, "context\.budget"\)\} value=\{budget\}/);
    assert.match(panel, /<option value=\{option\}>/);
    assert.match(styles, /\.glean-resurface\s*\{\s*overflow-y:\s*auto/);
    assert.match(styles, /\.glean-resurface > \.glean-surf\s*\{\s*flex:\s*0 0 auto;\s*overflow:\s*visible/);
    assert.match(read("src/ui/ResurfaceView.svelte"), /observedIndex = \$state\.raw<GleanIndex \| null>\(null\)/);
});

test("情境选文刷新后保留已选但不再存在的主题并保留清除入口", () => {
    const panel = read("src/ui/ContextSelectionPanel.svelte");
    const tagSelect = panel.match(/<select aria-label=\{t\(i18n, "context\.tag"\)\}[\s\S]*?<\/select>/)?.[0] ?? "";
    assert.match(tagSelect, /value=\{selectedTag\} onchange=\{setTag\}/);
    assert.match(tagSelect, /<option value="">\{t\(i18n, "context\.allTags"\)\}<\/option>/);
    assert.match(tagSelect, /\{#if selectedTag && !userTags\.includes\(selectedTag\)\}\s*<option value=\{selectedTag\}>\{selectedTag\}<\/option>/);
});

test("情境选文打开按钮关联实例内稳定的文章标题", () => {
    const panel = read("src/ui/ContextSelectionPanel.svelte");
    const openButton = panel.match(/<button\b[\s\S]*?<\/button>/)?.[0] ?? "";
    assert.match(panel, /return `glean-context-selection-item-title-\$\{instanceId\}-\$\{itemId\}`/);
    assert.match(panel, /<h3 id=\{candidateTitleId\(candidate\.item\.id\)\}[^>]*>\{candidate\.item\.title \|\| t\(i18n, "panel\.untitled"\)\}/);
    assert.match(openButton, /aria-describedby=\{candidateTitleId\(candidate\.item\.id\)\}/);
    assert.match(openButton, /\{t\(i18n, "context\.open"\)\}/);
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
