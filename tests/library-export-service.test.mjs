import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const storeStub = `
export const reconcileIndex = (...args) => globalThis.__libraryExportStore.reconcileIndex(...args);
export const batchReadClipAttrs = (...args) => globalThis.__libraryExportStore.batchReadClipAttrs(...args);
export const readClipDocument = (...args) => globalThis.__libraryExportStore.readClipDocument(...args);
`;

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "./clip-store") {
            return { url: `data:text/javascript,${encodeURIComponent(storeStub)}`, shortCircuit: true };
        }
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
            return nextResolve(`${specifier}.ts`, context);
        }
        return nextResolve(specifier, context);
    },
});

const {
    exportLibraryCsv,
    exportArticleMarkdown,
    exportLibraryMarkdownArchive,
    exportAnonymousDiagnostic,
} = await import("../src/services/library-export-service.ts");

const defaultSettings = {
    anchorNotebooks: ["nb-1"],
    defaultInboxNotebook: "nb-1",
    ai: {
        enrichMode: "off",
        autoEnrichOnClip: false,
        generateSummary: false,
        generateTags: false,
        generateKeypoints: false,
        generateHighlights: false,
        generateFlashcards: false,
        dedupOnEnrich: false,
        relatedWhileReading: false,
        formattingEnabled: false,
    },
    integration: {
        bridgeWriteEnabled: false,
        checkinEnabled: false,
    },
};

const fakePlugin = {
    manifest: { version: "1.3.8" },
};

function makeIndexEntry(id, overrides = {}) {
    return {
        id,
        title: `文章 ${id}`,
        hpath: `/2026/10/${id}`,
        box: "nb-1",
        status: "inbox",
        tags: ["tech"],
        internal: false,
        url: `https://example.com/${id}`,
        site: "Example",
        ...overrides,
    };
}

test("exportLibraryCsv: 正常多状态导出、CSV 特殊符号转义与内部文档过滤", async () => {
    const entry1 = makeIndexEntry("doc-1", {
        title: "普通文章",
        status: "inbox",
        tags: ["tag1", "tag2"],
    });
    const entry2 = makeIndexEntry("doc-2", {
        title: '包含"引号"与,逗号的文章',
        status: "done",
        tags: ["tag2"],
    });
    const entryInternal = makeIndexEntry("doc-internal", {
        title: "内部隐藏文档",
        internal: true,
    });
    const entryUnconfirmed = makeIndexEntry("doc-unconfirmed", {
        title: "未入库文档",
        status: "",
    });

    globalThis.__libraryExportStore = {
        reconcileIndex: async () => ({
            version: 1,
            updatedAt: "2026-10-20T00:00:00.000Z",
            clips: {
                "doc-1": entry1,
                "doc-2": entry2,
                "doc-internal": entryInternal,
                "doc-unconfirmed": entryUnconfirmed,
            },
            candidates: {},
        }),
        batchReadClipAttrs: async () => [
            {
                id: "doc-1",
                attrs: {
                    "custom-clip-status": "inbox",
                    "custom-clip-url": "https://example.com/1",
                    "custom-clip-site": "Example Site",
                    "custom-clip-words": "1500",
                    "custom-clip-reading-position": '{"blockId":"b1","scrollTop":120}',
                },
            },
            {
                id: "doc-2",
                attrs: {
                    "custom-clip-status": "done",
                    "custom-clip-url": "https://example.com/2",
                    "custom-clip-site": "Example Site 2",
                    "custom-clip-rating": "5",
                    "custom-clip-priority": "3",
                    "custom-clip-done-time": "2026-10-20T12:00:00.000Z",
                },
            },
            {
                id: "doc-internal",
                attrs: {
                    "custom-clip-internal": "true",
                },
            },
            {
                id: "doc-unconfirmed",
                attrs: {},
            },
        ],
        readClipDocument: async () => { throw new Error("not needed"); },
    };

    const csv = await exportLibraryCsv(fakePlugin, defaultSettings);

    // 必须有 UTF-8 BOM
    assert.ok(csv.startsWith("\uFEFF"), "CSV 必须包含 UTF-8 BOM");

    const lines = csv.trim().split("\r\n");
    assert.equal(lines.length, 3, "表头 + 2 条有效文章数据");

    // 标题含有引号与逗号必须被正确转义
    assert.ok(lines[2].includes('"包含""引号""与,逗号的文章"'), "包含引号与逗号的标题必须被双引号转义");
    assert.ok(!csv.includes("内部隐藏文档"), "内部文档必须被排除");
    assert.ok(!csv.includes("未入库文档"), "无 status 属性的未确认文章必须被排除");
});

test("exportLibraryCsv: 空库或全排除时仅输出 BOM 与表头行", async () => {
    globalThis.__libraryExportStore = {
        reconcileIndex: async () => ({
            version: 1,
            updatedAt: "2026-10-20T00:00:00.000Z",
            clips: {},
            candidates: {},
        }),
        batchReadClipAttrs: async () => [],
        readClipDocument: async () => { throw new Error("not needed"); },
    };

    const csv = await exportLibraryCsv(fakePlugin, defaultSettings);
    assert.ok(csv.startsWith("\uFEFF"));
    const lines = csv.trim().split("\r\n");
    assert.equal(lines.length, 1, "仅包含表头");
    assert.ok(lines[0].includes("id,title,path,notebook,status,url"));
});

test("exportArticleMarkdown: 正常导出单篇 Markdown 与 YAML Frontmatter", async () => {
    const entry = makeIndexEntry("doc-single", {
        title: "单一文章标题",
        status: "reading",
        tags: ["reading-tag"],
    });

    globalThis.__libraryExportStore = {
        reconcileIndex: async () => ({
            version: 1,
            updatedAt: "2026-10-20T00:00:00.000Z",
            clips: { "doc-single": entry },
            candidates: {},
        }),
        batchReadClipAttrs: async () => [],
        readClipDocument: async (id) => {
            assert.equal(id, "doc-single");
            return {
                markdown: "## 正文段落\n\n这是一篇正文测试文章。",
                attrs: {
                    status: "reading",
                    url: "https://example.com/single",
                    site: "Single Site",
                    author: "Author A",
                    tags: ["reading-tag"],
                    aiTags: ["ai-summary-tag"],
                    summary: "AI 总结摘要",
                },
            };
        },
    };

    const res = await exportArticleMarkdown(fakePlugin, defaultSettings, "doc-single");
    assert.ok(res.filename.endsWith(".md"));
    assert.ok(res.filename.includes("单一文章标题"));
    assert.ok(res.content.startsWith("---\n"));
    assert.ok(res.content.includes('title: "单一文章标题"'));
    assert.ok(res.content.includes('url: "https://example.com/single"'));
    assert.ok(res.content.includes("这是一篇正文测试文章。"));
});

test("exportArticleMarkdown: 传入未收录或不存在的 docId 时抛出业务异常", async () => {
    globalThis.__libraryExportStore = {
        reconcileIndex: async () => ({
            version: 1,
            updatedAt: "2026-10-20T00:00:00.000Z",
            clips: {},
            candidates: {},
        }),
        batchReadClipAttrs: async () => [],
        readClipDocument: async () => { throw new Error("should not be called"); },
    };

    await assert.rejects(
        async () => {
            await exportArticleMarkdown(fakePlugin, defaultSettings, "non-existent-id");
        },
        {
            message: "文章尚未收录，无法导出 Markdown",
        }
    );
});

test("exportLibraryMarkdownArchive: 空读库返回空归档列表", async () => {
    globalThis.__libraryExportStore = {
        reconcileIndex: async () => ({
            version: 1,
            updatedAt: "2026-10-20T00:00:00.000Z",
            clips: {},
            candidates: {},
        }),
        batchReadClipAttrs: async () => [],
        readClipDocument: async () => { throw new Error("not needed"); },
    };

    const parts = await exportLibraryMarkdownArchive(fakePlugin, defaultSettings);
    assert.deepEqual(parts, []);
});

test("exportLibraryMarkdownArchive: 单篇文档读取失败时容灾跳过，不中断整体归档并记录 failure", async () => {
    const docGood1 = makeIndexEntry("doc-good-1", { title: "良品 1", status: "inbox" });
    const docBad = makeIndexEntry("doc-bad-2", { title: "损坏 2", status: "reading" });
    const docGood3 = makeIndexEntry("doc-good-3", { title: "良品 3", status: "done" });

    globalThis.__libraryExportStore = {
        reconcileIndex: async () => ({
            version: 1,
            updatedAt: "2026-10-20T00:00:00.000Z",
            clips: {
                "doc-good-1": docGood1,
                "doc-bad-2": docBad,
                "doc-good-3": docGood3,
            },
            candidates: {},
        }),
        batchReadClipAttrs: async () => [],
        readClipDocument: async (id) => {
            if (id === "doc-bad-2") {
                throw new Error("块不存在或内核读取超时");
            }
            return {
                markdown: `# 内容 ${id}`,
                attrs: {
                    status: id === "doc-good-1" ? "inbox" : "done",
                    url: `https://example.com/${id}`,
                    tags: ["test"],
                    aiTags: [],
                },
            };
        },
    };

    const parts = await exportLibraryMarkdownArchive(fakePlugin, defaultSettings);
    assert.equal(parts.length, 1);
    const part = parts[0];
    assert.equal(part.filename, "siyuan-glean-markdown-01.zip");
    assert.equal(part.articleCount, 2, "成功导出的文章数量应为 2");
    assert.equal(part.failedCount, 1, "失败文章数量应为 1");
    assert.ok(part.bytes instanceof Uint8Array);
    assert.ok(part.bytes.length > 0);

    // 解析 zip 中的 index.json 验证故障记录
    const text = new TextDecoder().decode(part.bytes);
    assert.ok(text.includes('"id": "doc-bad-2"'));
    assert.ok(text.includes("块不存在或内核读取超时"));
    assert.ok(text.includes('"id": "doc-good-1"'));
    assert.ok(text.includes('"id": "doc-good-3"'));
});

test("exportLibraryMarkdownArchive: 超过容量限制时自动分包切为多卷 ZIP", async () => {
    // 构造两篇足以撑爆 16MB 的大文章
    const docBig1 = makeIndexEntry("doc-big-1", { title: "大型文章 1", status: "inbox" });
    const docBig2 = makeIndexEntry("doc-big-2", { title: "大型文章 2", status: "done" });

    // 每篇 9MB，两篇 18MB > 16MB (ARCHIVE_PART_MAX_BYTES)
    const largeContent = "a".repeat(9 * 1024 * 1024);

    globalThis.__libraryExportStore = {
        reconcileIndex: async () => ({
            version: 1,
            updatedAt: "2026-10-20T00:00:00.000Z",
            clips: {
                "doc-big-1": docBig1,
                "doc-big-2": docBig2,
            },
            candidates: {},
        }),
        batchReadClipAttrs: async () => [],
        readClipDocument: async (id) => ({
            markdown: largeContent,
            attrs: {
                status: id === "doc-big-1" ? "inbox" : "done",
                url: `https://example.com/${id}`,
                tags: [],
                aiTags: [],
            },
        }),
    };

    const parts = await exportLibraryMarkdownArchive(fakePlugin, defaultSettings);
    assert.equal(parts.length, 2, "超出单卷上限时必须自动切分为两卷");
    assert.equal(parts[0].filename, "siyuan-glean-markdown-01.zip");
    assert.equal(parts[1].filename, "siyuan-glean-markdown-02.zip");
    assert.equal(parts[0].articleCount, 1);
    assert.equal(parts[1].articleCount, 1);
});

test("exportAnonymousDiagnostic: 正常聚合读库状态并脱敏输出", async () => {
    globalThis.__libraryExportStore = {
        reconcileIndex: async () => ({
            version: 1,
            updatedAt: "2026-10-20T08:00:00.000Z",
            clips: {
                "d-1": makeIndexEntry("d-1", { status: "inbox" }),
                "d-2": makeIndexEntry("d-2", { status: "reading" }),
                "d-3": makeIndexEntry("d-3", { status: "done" }),
                "d-4": makeIndexEntry("d-4", { status: "archived" }),
            },
            candidates: {
                "c-1": { id: "c-1", title: "候选 1" },
            },
        }),
        batchReadClipAttrs: async () => [],
        readClipDocument: async () => { throw new Error("not needed"); },
    };

    const jsonStr = await exportAnonymousDiagnostic(fakePlugin, defaultSettings, "desktop");
    const diag = JSON.parse(jsonStr);

    assert.equal(diag.version, 1);
    assert.equal(diag.pluginVersion, "1.3.8");
    assert.equal(diag.apiVersion, "siyuan-kernel-http-v1");
    assert.equal(diag.index.fresh, true);
    assert.equal(diag.index.clipCount, 4);
    assert.equal(diag.index.candidateCount, 1);
    assert.equal(diag.frontend, "desktop");
    assert.equal(diag.featureSwitches.ai, false);
    assert.equal(diag.featureSwitches.checkin, false);
});

test("exportAnonymousDiagnostic: reconcileIndex 异常时安全捕获并记录 failure，不抛出异常", async () => {
    globalThis.__libraryExportStore = {
        reconcileIndex: async () => {
            throw new Error("思源存储不可用或数据库锁定");
        },
        batchReadClipAttrs: async () => [],
        readClipDocument: async () => { throw new Error("not needed"); },
    };

    const jsonStr = await exportAnonymousDiagnostic(fakePlugin, defaultSettings, "mobile");
    const diag = JSON.parse(jsonStr);

    assert.equal(diag.version, 1);
    assert.equal(diag.pluginVersion, "1.3.8");
    assert.equal(diag.index.fresh, false);
    assert.equal(diag.index.clipCount, 0);
    assert.equal(diag.frontend, "mobile");
    assert.equal(diag.failure.phase, "reconcile");
});
