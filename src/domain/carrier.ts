/**
 * 阅读载体与打开策略（S3/T-1716/T-1722）。
 *
 * 载体来自文档属性投影；本模块只决定用户可见的目标，不写状态。
 * 思源 openTab 只接受文档、资产等内部目标，因此来源网页由 UI 在用户
 * 点击时以标准浏览器窗口打开。全文和仅链接载体可以提供来源网页的
 * 次级动作；主打开目标仍由载体决定，URL 仍须通过 normalizeUrl 的
 * http(s) 校验。
 */
import { normalizeUrl } from "./url.ts";

export type ClipCarrier = "fulltext" | "link" | "local" | "unknown";
export type CarrierOpenTarget = "document" | "source";

export function resolveCarrier(value: string | undefined): ClipCarrier {
    if (value === "fulltext" || value === "link" || value === "local") return value;
    return "unknown";
}

/**
 * 返回可显示的来源网页地址。
 *
 * 全文剪藏有来源时也允许“打开原文”作为次级动作；这不会改变全文
 * 的主打开目标。local 即使正文里偶然有链接也不能显示网页动作；旧文档
 * 可能没有 contentType，但只要 custom-clip-url 有效，仍应保留来源动作。
 */
export function sourceUrlForCarrier(contentType: string | undefined, rawUrl: string | undefined): string {
    const carrier = resolveCarrier(contentType);
    if (carrier === "local") return "";
    const value = String(rawUrl ?? "").trim();
    return normalizeUrl(value) ? value : "";
}

export function openTargetForCarrier(contentType: string | undefined, rawUrl: string | undefined): CarrierOpenTarget {
    // 仅链接没有本地正文，因此来源网页是主入口；全文即使有来源也优先
    // 打开思源正文；local/unknown 一律打开文档说明页。
    return resolveCarrier(contentType) === "link" && sourceUrlForCarrier(contentType, rawUrl) ? "source" : "document";
}

export function hasSourceAction(contentType: string | undefined, rawUrl: string | undefined): boolean {
    return Boolean(sourceUrlForCarrier(contentType, rawUrl));
}
