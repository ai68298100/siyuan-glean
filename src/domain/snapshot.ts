/**
 * 快照路径纯函数（T-1504）。
 * 资产路径 = /<笔记本>/assets/glean-<docId>-<时间戳>.html（思源资产按笔记本 assets 目录识别）。
 */

export function snapshotAssetPath(box: string, docId: string, now: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const safeBox = box.replace(/[^0-9a-zA-Z-]/g, "") || "assets";
    return `/${safeBox}/assets/glean-${docId}-${stamp}.html`;
}
