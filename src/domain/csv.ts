/**
 * CSV 导出（T-1772，纯函数）：RFC 4180 转义——含逗号/引号/换行的字段加引号，引号翻倍。
 * BOM 由调用方在字节层添加（Excel 中文兼容），这里只产字符串。
 */

/** 单元格转义：需要引号包裹的判定 = 含逗号、双引号、换行（\r\n 或 \n）。 */
export function csvCell(value: string | number | null | undefined): string {
    const text = String(value ?? "");
    if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

/** 行数组 → CSV 文本（\r\n 行尾，RFC 4180）。 */
export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
    return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
