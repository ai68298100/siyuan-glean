import type { DocRow } from "../api/client";
import { querySql } from "../api/client";
import { matchesLibraryFilter } from "../domain/library-view";
import { CLIP_STATUSES, parseClipAttrs, parseUserTags, siyuanTimestamp, type ClipAttrs, type ClipStatus } from "../domain/schema";
import { logCheckinEventSafely } from "../libs/ecosystem-bridge-kit";
import type { GleanFacade } from "../types";
import { batchReadClipAttrs, reconcileIndex, writeClip } from "./clip-store";

export interface GleanBridgeClip {
    id: string;
    title: string;
    hpath: string;
    box: string;
    updated: string;
    status: ClipStatus;
    url: string;
    site: string;
    tags: string[];
    aiTags: string[];
    src: string;
    time: string;
    doneTime: string;
    timeSource?: ClipAttrs["timeSource"];
    contentType?: ClipAttrs["contentType"];
    words?: number;
    minutes?: number;
    readMinutes?: number;
    priority?: number;
    rating?: number;
    lastSurfaced: string;
    pinned: string;
    summary: string;
    snapshot: string;
}

export interface GleanBridgeFilter {
    status?: ClipStatus | "all";
    site?: string;
    tag?: string;
    aiTag?: string;
    keyword?: string;
    direction?: "asc" | "desc";
    limit?: number;
    offset?: number;
}

export const LVGLEAN_BRIDGE_PROTOCOL = 1;
export const LVGLEAN_API_NAME = "siyuanGlean";
export const LVGLEAN_API_ALIASES = [
    "siyuanGlean",
    "xiaolvGlean",
    "lvGlean",
    "LvGlean",
] as const;

export type LvGleanApiAlias = (typeof LVGLEAN_API_ALIASES)[number];

export interface GleanBridgeOverview {
    protocol: number;
    apiVersion: number;
    version: string;
    capabilities: readonly string[];
    writable: boolean;
    updatedAt: string;
}

export interface GleanBridge {
    readonly protocol: 1;
    readonly apiVersion: 1;
    readonly version: string;
    readonly capabilities: readonly string[];
    whenReady(): Promise<boolean>;
    listClips(filter?: GleanBridgeFilter): Promise<GleanBridgeClip[]>;
    getClip(id: string): Promise<GleanBridgeClip | null>;
    setClipStatus(id: string, status: ClipStatus): Promise<void>;
    getOverview(): GleanBridgeOverview;
}

interface BridgeHost {
    siyuanGlean?: unknown;
    xiaolvGlean?: unknown;
    lvGlean?: unknown;
    LvGlean?: unknown;
}

type BridgeFacade = Pick<GleanFacade, "pluginInstance" | "settings" | "notifyDataChanged">;
type ClipMeta = Pick<GleanBridgeClip, "id" | "title" | "hpath" | "box" | "updated">;

declare global {
    interface Window {
        siyuanGlean?: GleanBridge;
        xiaolvGlean?: GleanBridge;
        lvGlean?: GleanBridge;
        LvGlean?: GleanBridge;
    }
}

function validateDocumentId(id: string): void {
    if (typeof id !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(id)) {
        throw new TypeError("Invalid document ID");
    }
}

function isClipStatus(status: unknown): status is ClipStatus {
    return typeof status === "string" && CLIP_STATUSES.some((value) => value === status);
}

function normalizeFilter(filter: GleanBridgeFilter): Required<Pick<GleanBridgeFilter, "limit" | "offset" | "direction">> & GleanBridgeFilter {
    if (!filter || typeof filter !== "object" || Array.isArray(filter)) throw new TypeError("Invalid clip filter");
    const { status, site, tag, aiTag, keyword } = filter;
    const limit = filter.limit === undefined ? 100 : filter.limit;
    const offset = filter.offset === undefined ? 0 : filter.offset;
    const direction = filter.direction === undefined ? "asc" : filter.direction;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new RangeError("limit must be an integer from 1 to 200");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError("offset must be a nonnegative safe integer");
    if (status !== undefined && status !== "all" && !isClipStatus(status)) throw new TypeError("Invalid clip status filter");
    if (direction !== "asc" && direction !== "desc") throw new TypeError("Invalid clip sort direction");
    for (const value of [site, tag, aiTag, keyword]) {
        if (value !== undefined && typeof value !== "string") throw new TypeError("Clip filters must be strings");
    }
    return { status, site, tag, aiTag, keyword, limit, offset, direction };
}

function projectClip(meta: ClipMeta, attrs: ClipAttrs, tags: string[]): GleanBridgeClip | null {
    if (!attrs.status || attrs.internal) return null;
    return {
        id: meta.id,
        title: meta.title,
        hpath: meta.hpath,
        box: meta.box,
        updated: meta.updated,
        status: attrs.status,
        url: attrs.url ?? "",
        site: attrs.site ?? "",
        tags: [...tags],
        aiTags: [...attrs.aiTags],
        src: attrs.src ?? "",
        time: attrs.time ?? "",
        doneTime: attrs.doneTime ?? "",
        timeSource: attrs.timeSource,
        contentType: attrs.contentType,
        words: attrs.words,
        minutes: attrs.minutes,
        readMinutes: attrs.readMinutes,
        priority: attrs.priority,
        rating: attrs.rating,
        lastSurfaced: attrs.lastSurfaced ?? "",
        pinned: attrs.pinned ?? "",
        summary: attrs.summary ?? "",
        snapshot: attrs.snapshot ?? "",
    };
}

export function installBridge(facade: BridgeFacade, version: string, host: BridgeHost = window): () => void {
    if ("siyuanGlean" in host) return () => undefined;
    let active = true;
    let pending = Promise.resolve();

    function assertActive(): void {
        if (!active) throw new Error("Glean bridge has been unloaded");
    }

    function assertWritable(): void {
        assertActive();
        if (facade.settings.integration.bridgeWriteEnabled !== true) throw new Error("Glean bridge writes are disabled");
    }

    function run<Result>(operation: () => Promise<Result>): Promise<Result> {
        const result = pending.then(() => {
            assertActive();
            return operation();
        });
        pending = result.then(() => undefined, () => undefined);
        return result;
    }

    async function readDocument(id: string): Promise<GleanBridgeClip | null> {
        const rows = await querySql<DocRow>(`SELECT id, content, hpath, box, updated FROM blocks WHERE id = '${id}' AND type = 'd' LIMIT 1`);
        assertActive();
        const row = rows[0];
        if (!row) return null;
        const pairs = await batchReadClipAttrs([id]);
        assertActive();
        const ial = pairs.find((pair) => pair.id === id)?.attrs;
        if (!ial) return null;
        return projectClip({ id, title: row.content || "", hpath: row.hpath || "", box: row.box || "", updated: row.updated || "" }, parseClipAttrs(ial), parseUserTags(ial.tags));
    }

    const capabilities = [
        "listClips",
        "getClip",
        "setClipStatus",
        "whenReady",
        "getOverview",
    ] as const;

    const bridge: GleanBridge = Object.freeze({
        protocol: LVGLEAN_BRIDGE_PROTOCOL,
        apiVersion: 1,
        version,
        capabilities,
        async whenReady() {
            assertActive();
            return true;
        },
        getOverview() {
            assertActive();
            return {
                protocol: LVGLEAN_BRIDGE_PROTOCOL,
                apiVersion: 1,
                version,
                capabilities,
                writable: facade.settings.integration.bridgeWriteEnabled === true,
                updatedAt: new Date().toISOString(),
            };
        },
        async listClips(filter: GleanBridgeFilter = {}): Promise<GleanBridgeClip[]> {
            assertActive();
            const normalized = normalizeFilter(filter);
            return run(async () => {
                const index = await reconcileIndex(facade.pluginInstance, facade.settings);
                assertActive();
                const entries = Object.values(index.clips);
                const pairs = await batchReadClipAttrs(entries.map((entry) => entry.id));
                assertActive();
                const attrsById = new Map(pairs.map((pair) => [pair.id, pair.attrs]));
                const clips: GleanBridgeClip[] = [];
                for (const entry of entries) {
                    const ial = attrsById.get(entry.id);
                    if (!ial) continue;
                    const clip = projectClip(entry, parseClipAttrs(ial), parseUserTags(ial.tags));
                    if (clip && matchesLibraryFilter({ kind: "clip", ...clip }, normalized)) clips.push(clip);
                }
                clips.sort((left, right) => {
                    const compared = left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
                    return normalized.direction === "asc" ? compared : -compared;
                });
                return clips.slice(normalized.offset, normalized.offset + normalized.limit);
            });
        },
        async getClip(id: string): Promise<GleanBridgeClip | null> {
            assertActive();
            validateDocumentId(id);
            return run(() => readDocument(id));
        },
        async setClipStatus(id: string, status: ClipStatus): Promise<void> {
            assertWritable();
            validateDocumentId(id);
            if (!isClipStatus(status)) throw new TypeError("Invalid clip status");
            return run(async () => {
                assertWritable();
                const clip = await readDocument(id);
                assertWritable();
                if (!clip) throw new Error("Not a confirmed reading library article");
                const patch: Partial<ClipAttrs> = { status };
                if (status === "done") patch.doneTime = siyuanTimestamp();
                const written = await writeClip(facade.pluginInstance, id, patch, { forceStatus: true });
                assertActive();
                if (status === "done" && facade.settings.integration.checkinEnabled && facade.settings.integration.checkinItemId) {
                    void logCheckinEventSafely({
                        itemId: facade.settings.integration.checkinItemId,
                        value: 1,
                        externalRef: `glean:${clip.id}:${new Date().toISOString().slice(0, 10)}`,
                        note: `完成文章阅读：《${clip.title}》`,
                    });
                }
                // The document attribute is the source of truth. A failed
                // derived-index save is recoverable and must not make callers
                // repeat a real write; surface refresh will reconcile it.
                if (written.indexSyncFailed) {
                    facade.notifyDataChanged();
                    return;
                }
                facade.notifyDataChanged();
            });
        },
    });
    const mounted: string[] = [];
    const hostRecord = host as Record<string, unknown>;
    for (const alias of LVGLEAN_API_ALIASES) {
        if (!hostRecord[alias] || hostRecord[alias] === bridge) {
            hostRecord[alias] = bridge;
            mounted.push(alias);
        }
    }
    return () => {
        active = false;
        for (const alias of mounted) {
            if (hostRecord[alias] === bridge) delete hostRecord[alias];
        }
    };
}
