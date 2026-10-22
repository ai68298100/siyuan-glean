/**
 * 摘录服务（T-1730d，D-0030 落点 T-1725）：选区 → 引述块插入原文档。
 * 块定位即摘录位置；无法取得块定位时 UI 明确降级为"仅复制文本"，不伪造锚点。
 * T-1752：筛选后的摘录批量导出为普通汇总笔记（含原文回链；不写 custom-clip-*，
 * 无 URL/标签/模板证据不会进入候选扫描）。
 */
import { createDocWithMd, insertBlockAfter, isKernelRequestError, newNodeId, querySql } from "../api/client";
import { escapeDomText } from "../domain/flashcard";
import { buildQuoteBlockDom, clampExcerpt, EXCERPT_MAX_LENGTH } from "../domain/reader";
import { quoteExportMarkdown, type QuoteEntry } from "../domain/quotes";
import { siyuanTimestamp } from "../domain/schema";

const BLOCK_ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;
const quoteExportFlights = new Map<string, Promise<string>>();
const uncertainQuoteExports = new Map<string, { notebookId: string; operationKey: string; fingerprint: string; hpath: string }>();

export class QuoteExportError extends Error {
    readonly reason: "unknown" | "ambiguous" | "operationChanged";
    readonly operationKey: string;

    constructor(
        reason: "unknown" | "ambiguous" | "operationChanged",
        message: string,
        operationKey: string,
    ) {
        super(message);
        this.name = "QuoteExportError";
        this.reason = reason;
        this.operationKey = operationKey;
    }
}

export interface ExcerptSelection {
    text: string;
    /** 所选内容所在块的 ID；取不到为空串（定位失败）。 */
    blockId: string;
}

/** 文档级 selectionchange 的低成本端点门禁；不读取 range 或选中文本，完整归属仍由摘录解析复核。 */
export function selectionBelongsToHost(host: Element | null, selection: Selection | null): boolean {
    if (!host || !selection) return false;
    try {
        if (selection.isCollapsed !== false || !selection.anchorNode || !selection.focusNode) return false;
        return host.contains(selection.anchorNode) && host.contains(selection.focusNode);
    } catch {
        return false;
    }
}

/** 从 DOM 选区提取摘录：仅当完整选区落在宿主元素内；无文本返回 null。 */
export function excerptFromSelection(host: Element | null, selection: Selection | null): ExcerptSelection | null {
    if (!host || !selection) return null;
    try {
        if (selection.isCollapsed !== false) return null;
        const rangeCount = selection.rangeCount;
        if (!Number.isInteger(rangeCount) || rangeCount < 1) return null;
        const anchorNode = selection.anchorNode;
        if (!selectionBelongsToHost(host, selection)) return null;
        if (!anchorNode) return null;
        for (let rangeIndex = 0; rangeIndex < rangeCount; rangeIndex += 1) {
            const range = selection.getRangeAt(rangeIndex);
            if (!range) return null;
            const startNode = range.startContainer;
            const endNode = range.endContainer;
            if (!startNode || !endNode || !host.contains(startNode) || !host.contains(endNode)) return null;
        }
        const text = clampExcerpt(selection.toString());
        if (!text) return null;
        const anchor = anchorNode.nodeType === 1 ? (anchorNode as Element) : anchorNode.parentElement;
        const blockEl = anchor?.closest("[data-node-id]");
        const blockId = blockEl && blockEl !== host && host.contains(blockEl) ? blockEl.getAttribute("data-node-id") ?? "" : "";
        return { text, blockId: BLOCK_ID_PATTERN.test(blockId) ? blockId : "" };
    } catch {
        return null;
    }
}

/** 摘录为引述块：插在所选块之后；支持附加个人思考批注（memo）；返回引述块 ID。 */
export async function insertQuoteExcerpt(blockId: string, text: string, memo?: string): Promise<string> {
    if (typeof blockId !== "string" || !BLOCK_ID_PATTERN.test(blockId)) throw new Error("摘录块 ID 无效");
    const rawQuote = clampExcerpt(text).slice(0, EXCERPT_MAX_LENGTH);
    const trimmedMemo = memo?.trim() ? memo.trim().slice(0, EXCERPT_MAX_LENGTH) : "";
    const fullText = trimmedMemo ? `${rawQuote}\n\n💡 ${trimmedMemo}` : rawQuote;
    const dom = buildQuoteBlockDom(fullText, escapeDomText);
    if (!dom) throw new Error("摘录内容为空");
    return insertBlockAfter(blockId, dom);
}

/**
 * 批量导出摘录为汇总笔记（T-1752）：写入第一个锚点笔记本 /摘录导出/ 下。
 * 返回文档 ID；空集合抛错由调用方提示。
 */
export async function exportQuotesToDoc(entries: QuoteEntry[], notebookId: string, retryKey = ""): Promise<string> {
    if (entries.length === 0) throw new Error("当前没有可导出的摘录");
    if (!notebookId.trim()) throw new Error("导出笔记本无效");
    const now = new Date();
    const fingerprint = JSON.stringify(entries);
    const recoveredOperation = retryKey ? null : [...uncertainQuoteExports.values()].find((operation) => operation.notebookId === notebookId && operation.fingerprint === fingerprint);
    const operationKey = retryKey || recoveredOperation?.operationKey || newNodeId(now);
    if (!BLOCK_ID_PATTERN.test(operationKey)) throw new Error("摘录导出操作键无效");
    const flightKey = JSON.stringify([notebookId, operationKey]);
    const active = quoteExportFlights.get(flightKey);
    if (active) return active;

    const uncertain = uncertainQuoteExports.get(flightKey);
    if (uncertain) {
        if (uncertain.notebookId !== notebookId || uncertain.fingerprint !== fingerprint) {
            throw new QuoteExportError("operationChanged", "摘录导出内容已变化，请开始一次新的导出", operationKey);
        }
        const reconciliation = findQuoteExport(notebookId, uncertain.hpath).then((matches) => {
            const existingId = uniqueQuoteExportId(matches, operationKey);
            if (existingId) {
                uncertainQuoteExports.delete(flightKey);
                return existingId;
            }
            throw new QuoteExportError("unknown", "暂时无法确认导出是否完成；再次重试会先核对原目标，不会重复创建", operationKey);
        }).catch((error) => {
            if (error instanceof QuoteExportError) throw error;
            throw new QuoteExportError("unknown", "暂时无法确认导出是否完成；请检查摘录导出目录后再重试", operationKey);
        });
        quoteExportFlights.set(flightKey, reconciliation);
        try {
            return await reconciliation;
        } finally {
            if (quoteExportFlights.get(flightKey) === reconciliation) quoteExportFlights.delete(flightKey);
        }
    }

    const stamp = siyuanTimestamp(now);
    const rangeLabel = `${stamp.slice(0, 4)}.${stamp.slice(4, 6)}.${stamp.slice(6, 8)}`;
    const markdown = quoteExportMarkdown(entries, rangeLabel, `${rangeLabel} ${stamp.slice(8, 10)}:${stamp.slice(10, 12)}`);
    const hpath = `/摘录导出/${stamp.slice(0, 8)}-${stamp.slice(8)}-${operationKey.slice(-7)}`;
    const creation = (async () => {
        try {
            const docId = await createDocWithMd(notebookId, hpath, markdown);
            if (!docId) throw new Error("创建摘录导出文档失败");
            return docId;
        } catch (error) {
            if (!isKernelRequestError(error) || (error.kind !== "network" && error.kind !== "timeout")) throw error;
            uncertainQuoteExports.set(flightKey, { notebookId, operationKey, fingerprint, hpath });
            try {
                const matches = await findQuoteExport(notebookId, hpath);
                const existingId = uniqueQuoteExportId(matches, operationKey);
                if (existingId) {
                    uncertainQuoteExports.delete(flightKey);
                    return existingId;
                }
            } catch (reconciliationError) {
                if (reconciliationError instanceof QuoteExportError && reconciliationError.reason === "ambiguous") throw reconciliationError;
            }
            throw new QuoteExportError("unknown", "暂时无法确认导出是否完成；再次重试会先核对原目标，不会重复创建", operationKey);
        }
    })();
    quoteExportFlights.set(flightKey, creation);
    try {
        return await creation;
    } finally {
        if (quoteExportFlights.get(flightKey) === creation) quoteExportFlights.delete(flightKey);
    }
}

async function findQuoteExport(notebookId: string, hpath: string): Promise<Array<{ id: unknown; box: unknown; hpath: unknown }>> {
    const safe = (value: string) => value.replace(/'/g, "''");
    const rows = await querySql<{ id: unknown; box: unknown; hpath: unknown }>(
        `SELECT id, box, hpath FROM blocks WHERE type = 'd' AND box = '${safe(notebookId)}' AND hpath = '${safe(hpath)}'`
    );
    return rows.filter((row) => row.box === notebookId && row.hpath === hpath);
}

function uniqueQuoteExportId(rows: Array<{ id: unknown }>, operationKey: string): string | null {
    if (rows.length > 1) throw new QuoteExportError("ambiguous", "找到多个同路径文档，无法安全确认导出结果", operationKey);
    const id = rows[0]?.id;
    return typeof id === "string" && BLOCK_ID_PATTERN.test(id) ? id : null;
}
