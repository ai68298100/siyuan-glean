import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const reader = readFileSync(resolve(root, "src/ui/ReaderTab.svelte"), "utf8");
const preview = readFileSync(resolve(root, "src/ui/WorkbenchPreview.svelte"), "utf8");
const context = readFileSync(resolve(root, "src/ui/ReadingContext.svelte"), "utf8");
const styles = readFileSync(resolve(root, "src/index.scss"), "utf8");
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

test("阅读器验收文档明确真实宿主边界", () => {
    for (const term of ["正文缺失诊断", "原文降级", "选区摘录", "制卡", "回跳", "移动动作面", "B-0002"]) {
        assert.ok(guide.includes(term), `验收文档缺少 ${term}`);
    }
    assert.match(guide, /真实验收边界/);
    assert.match(guide, /可见动作条/);
});
