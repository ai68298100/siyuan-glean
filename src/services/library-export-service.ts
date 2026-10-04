import type { Plugin } from "siyuan";
import type { GleanSettings } from "./settings";
import { batchReadClipAttrs, reconcileIndex } from "./clip-store";
import { renderLibraryCsv, type LibraryExportRow } from "../domain/library-export";
import { renderDiagnosticJson, type AnonymousDiagnostic } from "../domain/diagnostics";
import { ATTR, parseClipAttrs } from "../domain/schema";

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
