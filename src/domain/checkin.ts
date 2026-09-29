/**
 * 小驴打卡协同域层（T-1505，纯函数）。
 * 契约：window.siyuanCheckin v5（docs/api-v5.md + contracts/siyuan-checkin-contract）。
 * externalRef 幂等身份：`glean:<docId>:<localDate>`（前缀 glean 待向打卡仓库登记，
 * identity-and-merge.md 规则：同一外部事件永远使用相同 source+externalRef）。
 */

/** localDate YYYY-MM-DD（本地日解释，与打卡契约一致）。 */
export function localDate(now: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 幂等引用：同一文档同一天永远相同（重复写入会被宿主去重）。 */
export function readingEventRef(docId: string, now: Date = new Date()): string {
    return `glean:${docId}:${localDate(now)}`;
}

/** 打卡事件备注（可诊断、可读）。 */
export function readingEventNote(docTitle: string): string {
    return docTitle ? `小驴拾遗：读完《${docTitle}》` : "小驴拾遗：读完一篇重浮文章";
}
