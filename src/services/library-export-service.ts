import type { Plugin } from "siyuan";
import type { GleanSettings } from "./settings";
import { batchReadClipAttrs, readClipDocument, reconcileIndex } from "./clip-store";
import { renderLibraryCsv, type LibraryExportRow } from "../domain/library-export";
import { renderDiagnosticJson, type AnonymousDiagnostic } from "../domain/diagnostics";
import { ATTR, parseClipAttrs } from "../domain/schema";
import { articleMarkdownFilename, ARCHIVE_PART_MAX_BYTES, archiveArticlePath, buildStoredZip, estimateZipEntryBytes, renderArchiveIndex, renderArticleMarkdown, type ArchiveFile, type MarkdownArticleMeta } from "../domain/markdown-export";

function pluginVersion(plugin: Plugin): string {
    const manifest = (plugin as Plugin & { manifest?: { version?: unknown } }).manifest;
    return typeof manifest?.version === "string" ? manifest.version : "unknown";
}

export async function exportLibraryCsv(plugin: Plugin, settings: GleanSettings): Promise<string> {
    const index = await reconcileIndex(plugin, settings);
    const ids = Object.keys(index.clips);
    const pairs = await batchReadClipAttrs(ids);
    const attrs = new Map(pairs.map((pair) => [pair.id, pair.attrs]));
    const rows: LibraryExportRow[] = [];
    for (const entry of Object.values(index.clips).sort((left, right) => left.id.localeCompare(right.id))) {
        const value = attrs.get(entry.id);
        if (!value || value[ATTR.internal] === "true") continue;
        const parsed = parseClipAttrs(value);
        if (!parsed.status) continue;
        rows.push({
            id: entry.id,
            title: entry.title,
            path: entry.hpath,
            notebook: entry.box,
            status: parsed.status,
            url: parsed.url ?? "",
            site: parsed.site ?? "",
            author: parsed.author ?? "",
            time: parsed.time ?? "",
            doneTime: parsed.doneTime ?? "",
            words: parsed.words ?? "",
            minutes: parsed.minutes ?? "",
            readMinutes: parsed.readMinutes ?? "",
            priority: parsed.priority ?? "",
            rating: parsed.rating ?? "",
            source: parsed.src ?? "",
            contentType: parsed.contentType ?? "",
            timeSource: parsed.timeSource ?? "",
            lastSurfaced: parsed.lastSurfaced ?? "",
            pinned: parsed.pinned ?? "",
            userTags: [...entry.tags],
            aiTags: [...parsed.aiTags],
            summary: parsed.summary ?? "",
            snapshot: parsed.snapshot ?? "",
            readingPosition: parsed.readingPosition ? JSON.stringify(parsed.readingPosition) : "",
        });
    }
    return renderLibraryCsv(rows);
}

export interface MarkdownExport {
    filename: string;
    content: string;
}

export interface MarkdownArchivePart {
    filename: string;
    bytes: Uint8Array;
    articleCount: number;
    failedCount: number;
}

function exportMeta(entry: { id: string; title: string; hpath: string; box: string; tags: string[] }, attrs: ReturnType<typeof parseClipAttrs>): MarkdownArticleMeta {
    return {
        id: entry.id,
        title: entry.title,
        path: entry.hpath,
        notebook: entry.box,
        status: attrs.status ?? "",
        url: attrs.url ?? "",
        site: attrs.site ?? "",
        author: attrs.author ?? "",
        time: attrs.time ?? "",
        doneTime: attrs.doneTime ?? "",
        source: attrs.src ?? "",
        contentType: attrs.contentType ?? "",
        tags: [...entry.tags],
        aiTags: [...attrs.aiTags],
        summary: attrs.summary ?? "",
    };
}

/** Export one confirmed clip as a standalone Markdown download. */
export async function exportArticleMarkdown(plugin: Plugin, settings: GleanSettings, docId: string): Promise<MarkdownExport> {
    const index = await reconcileIndex(plugin, settings);
    const entry = index.clips[docId];
    if (!entry || entry.internal || !entry.status) throw new Error("文章尚未收录，无法导出 Markdown");
    const document = await readClipDocument(docId, { yfm: false, addTitle: false, refMode: 2 });
    if (document.attrs.internal || !document.attrs.status) throw new Error("文章状态已变化，无法导出 Markdown");
    const meta = exportMeta(entry, document.attrs);
    return { filename: articleMarkdownFilename(meta), content: renderArticleMarkdown(meta, document.markdown) };
}

/**
 * Export the library into stored ZIP parts. Each part contains an index.json
 * and one Markdown file per article; failed articles remain visible in the
 * index and do not abort the rest of the archive.
 */
export async function exportLibraryMarkdownArchive(plugin: Plugin, settings: GleanSettings, now = new Date()): Promise<MarkdownArchivePart[]> {
    const index = await reconcileIndex(plugin, settings);
    const entries = Object.values(index.clips)
        .filter((entry) => !entry.internal && entry.status)
        .sort((left, right) => left.id.localeCompare(right.id));
    const parts: MarkdownArchivePart[] = [];
    let files: ArchiveFile[] = [];
    let exported: Array<MarkdownArticleMeta & { file: string }> = [];
    let failures: Array<{ id: string; reason: string }> = [];
    let partNo = 1;
    const flush = () => {
        if (exported.length === 0 && failures.length === 0) return;
        const indexFile: ArchiveFile = { name: "index.json", content: renderArchiveIndex(exported, now.toISOString(), failures) };
        const bytes = buildStoredZip([indexFile, ...files]);
        parts.push({ filename: `siyuan-glean-markdown-${String(partNo).padStart(2, "0")}.zip`, bytes, articleCount: exported.length, failedCount: failures.length });
        partNo += 1;
        files = [];
        exported = [];
        failures = [];
    };
    for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        try {
            const document = await readClipDocument(entry.id, { yfm: false, addTitle: false, refMode: 2 });
            if (document.attrs.internal || !document.attrs.status) continue;
            const meta = exportMeta(entry, document.attrs);
            const file = archiveArticlePath(i, meta);
            const article = { name: file, content: renderArticleMarkdown(meta, document.markdown) };
            const projectedIndex = renderArchiveIndex([...exported, { ...meta, file }], now.toISOString(), failures);
            const projectedBytes = files.reduce((size, current) => size + estimateZipEntryBytes(current), estimateZipEntryBytes({ name: "index.json", content: projectedIndex })) + estimateZipEntryBytes(article);
            if (files.length > 0 && projectedBytes > ARCHIVE_PART_MAX_BYTES) flush();
            files.push(article);
            exported.push({ ...meta, file });
        } catch (error) {
            const failure = { id: entry.id, reason: error instanceof Error ? error.message.slice(0, 160) : "读取失败" };
            const projectedFailures = [...failures, failure];
            const projectedIndex = renderArchiveIndex(exported, now.toISOString(), projectedFailures);
            if (files.length > 0 && files.reduce((size, current) => size + estimateZipEntryBytes(current), estimateZipEntryBytes({ name: "index.json", content: projectedIndex })) > ARCHIVE_PART_MAX_BYTES) {
                flush();
            }
            failures.push(failure);
        }
    }
    flush();
    return parts;
}

export async function exportAnonymousDiagnostic(
    plugin: Plugin,
    settings: GleanSettings,
    frontend: string,
): Promise<string> {
    let diagnostic: AnonymousDiagnostic;
    try {
        const index = await reconcileIndex(plugin, settings);
        diagnostic = {
            version: 1,
            pluginVersion: pluginVersion(plugin),
            apiVersion: "siyuan-kernel-http-v1",
            index: { updatedAt: index.updatedAt, fresh: true, clipCount: Object.keys(index.clips).length, candidateCount: Object.keys(index.candidates).length },
            featureSwitches: {
                ai: settings.ai.enrichMode !== "off",
                aiDedup: settings.ai.dedupOnEnrich,
                relatedReading: settings.ai.relatedWhileReading,
                formatting: settings.ai.formattingEnabled,
                bridgeWrite: settings.integration.bridgeWriteEnabled,
                checkin: settings.integration.checkinEnabled,
            },
            frontend,
        };
    } catch (error) {
        diagnostic = {
            version: 1,
            pluginVersion: pluginVersion(plugin),
            apiVersion: "siyuan-kernel-http-v1",
            index: { updatedAt: "", fresh: false, clipCount: 0, candidateCount: 0 },
            featureSwitches: {
                ai: settings.ai.enrichMode !== "off",
                aiDedup: settings.ai.dedupOnEnrich,
                relatedReading: settings.ai.relatedWhileReading,
                formatting: settings.ai.formattingEnabled,
                bridgeWrite: settings.integration.bridgeWriteEnabled,
                checkin: settings.integration.checkinEnabled,
            },
            frontend,
            failure: { phase: error instanceof Error ? "reconcile" : "unknown" },
        };
    }
    return renderDiagnosticJson(diagnostic);
}
