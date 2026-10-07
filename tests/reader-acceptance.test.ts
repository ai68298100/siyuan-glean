import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const reader = readFileSync(resolve(root, "src/ui/ReaderTab.svelte"), "utf8");
const protyle = readFileSync(resolve(root, "src/ui/ProtyleHost.svelte"), "utf8");
const preview = readFileSync(resolve(root, "src/ui/WorkbenchPreview.svelte"), "utf8");
const context = readFileSync(resolve(root, "src/ui/ReadingContext.svelte"), "utf8");
const styles = readFileSync(resolve(root, "src/index.scss"), "utf8");
const entry = readFileSync(resolve(root, "src/index.ts"), "utf8");
const guide = readFileSync(resolve(root, "docs/READER-ACCEPTANCE.md"), "utf8");

test("阅读页签覆盖正文诊断、载体降级、摘录、制卡、回跳和状态边界", () => {
    for (const source of [reader, context]) {
        assert.match(source, /fulltextBodyState/);
        assert.match(source, /measureClipBody/);
        assert.match(source, /hasSourceAction/);
        assert.match(source, /sourceUrlForCarrier/);
        assert.match(source, /clip\.bodyMissing/);
        assert.match(source, /clip\.reclip/);
    }
    assert.match(reader, /excerptFromSelection/);
    assert.match(reader, /selectionBelongsToHost/);
    assert.match(preview, /selectionBelongsToHost/);
    assert.match(reader, /insertQuoteExcerpt/);
    assert.match(reader, /makeQuoteCard/);
    assert.match(reader, /openLibraryArticle/);
    assert.match(reader, /doneAndNext/);
    assert.equal((reader.match(/>✓→ \{t\(i18n, "reader\.doneNext"\)\}<\/button>/g) ?? []).length, 1);
});

test("阅读页签快照图标和移动阅读动作可发现且可操作", () => {
    assert.match(reader, /snapshot\.open/);
    assert.match(reader, /snapshot\.take/);
    assert.match(reader, /aria-label=\{context\.snapshot \? t\(i18n, "snapshot\.open"\)/);
    assert.match(context, /glean-reading-context__actions/);
    assert.match(styles, /@media \(max-width: 560px\)[\s\S]*?\.glean-reading-context__source-btn[\s\S]*?min-height: 44px/);
});

test("阅读页签桌面首屏保留原型的外观与原文入口，窄屏不增加工具栏高度", () => {
    assert.match(reader, /class="glean-btn glean-btn--ghost glean-reader__toolbar-appearance"/);
    assert.match(reader, /class="glean-btn glean-btn--ghost glean-reader__toolbar-source"/);
    assert.match(reader, /bind:open=\{appearanceOpen\}/);
    assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.glean-reader__toolbar-appearance,[\s\S]*display: none/);
});

test("阅读帮助弹窗使用安全文本节点和主题令牌", () => {
    const start = entry.indexOf("showReaderHelp(): void");
    const end = entry.indexOf("/** 摘录制卡", start);
    assert.ok(start >= 0 && end > start);
    const help = entry.slice(start, end);
    assert.doesNotMatch(help, /innerHTML/);
    assert.match(help, /textContent = t\(this\.i18n, "help\.hint"\)/);
    assert.match(help, /className = "glean-reader-help__row"/);
    assert.match(styles, /\.glean-reader-help\s*\{[\s\S]*var\(--glean-space-2\)/);
    assert.match(styles, /\.glean-reader-help__row\s*\{[\s\S]*var\(--glean-text-md\)/);
});

test("阅读页签切文时收起上篇文章的低频工具状态", () => {
    assert.match(reader, /const id = docId;[\s\S]*?moreToolsOpen = false;\s*appearanceOpen = false;/);
});

test("Protyle 失败态在正文曾获焦时把焦点交给重试动作", () => {
    assert.match(protyle, /let retryButton = \$state<HTMLButtonElement \| null>\(null\);/);
    assert.match(protyle, /element\.addEventListener\("focusin", onFocusIn\)/);
    assert.match(protyle, /stage === "failed" && hostHadFocus/);
    assert.match(protyle, /bind:this=\{retryButton\}/);
    assert.match(protyle, /aria-live=\{stage === "failed" \? "assertive" : "polite"\}/);
});

test("原生阅读上下文把维护动作降级到按需展开，正文缺失时自动展开", () => {
    assert.match(context, /const maintenanceId = `glean-reading-context-maintenance-\$\{instanceId\}`;/);
    assert.match(context, /context = null;\s*loading = true;\s*loadError = false;\s*maintenanceOpen = false;\s*void reload\(\);/);
    assert.match(context, /bind:open=\{maintenanceOpen\}/);
    assert.match(context, /if \(bodyState === "missing"\) maintenanceOpen = true/);
    assert.match(context, /<details id=\{maintenanceId\}/);
    assert.match(styles, /\.glean-reading-context__maintenance > summary:focus-visible/);
    assert.ok(context.indexOf("<ClipStatusActions") < context.indexOf("<details id={maintenanceId}"));
    assert.ok(context.indexOf("formatting.open") > context.indexOf("<details id={maintenanceId}"));
});

test("原生阅读上下文读取失败保留可重试错误态", () => {
    assert.match(context, /let loadError = \$state\(false\);/);
    assert.match(context, /loadError = true;/);
    assert.match(context, /class="glean-reading-context glean-reading-context--error" role="alert"/);
    assert.match(context, /reading\.contextFailed/);
    assert.match(context, /onclick=\{\(\) => void reload\(\)\}/);
    assert.match(styles, /\.glean-reading-context--error[\s\S]*var\(--glean-error-surface\)/);
});

test("窄屏阅读上下文保持状态动作组完整宽度", () => {
    assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.glean-reading-context__actions > \.glean-status-actions[\s\S]*width: max-content/);
});

test("阅读上下文标题与元数据保持清晰层级", () => {
    assert.match(styles, /\.glean-reading-context__title[\s\S]*font-size: var\(--glean-text-md\)[\s\S]*font-weight: 700/);
    assert.match(styles, /\.glean-reading-context__meta[\s\S]*font-size: var\(--glean-text-xs\)/);
});

test("朗读增强默认收进辅助工具", () => {
    assert.match(reader, /glean-reader__more-tools-body[\s\S]*context && speechSupported[\s\S]*glean-reader__speech/);
    assert.doesNotMatch(reader, /glean-reader__section--enhanced glean-reader__speech/);
});

test("阅读器验收文档明确真实宿主边界", () => {
    for (const term of ["正文缺失诊断", "原文降级", "选区摘录", "制卡", "回跳", "移动动作面", "B-0002"]) {
        assert.ok(guide.includes(term), `验收文档缺少 ${term}`);
    }
    assert.match(guide, /真实验收边界/);
    assert.match(guide, /可见动作条/);
});
