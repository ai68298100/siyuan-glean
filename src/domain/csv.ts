/**
 * CSV 导出（T-1772，纯函数）：RFC 4180 转义——含逗号/引号/换行的字段加引号，引号翻倍；
 * 以 =+-@ 开头的单元格加前导单引号防公式注入（与 library-export/highlights/stats 同纪律）。
 * BOM 由调用方在字节层添加（Excel 中文兼容），这里只产字符串。
 */

/** 单元格转义：需要引号包裹的判定 = 含逗号、双引号、换行（\r\n 或 \n）或公式注入前缀。 */
export function csvCell(value: string | number | null | undefined): string {
    const text = String(value ?? "");
    const guarded = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
    if (/[",\r\n]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
    return guarded;
}

/** 行数组 → CSV 文本（\r\n 行尾，RFC 4180）。 */
export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
    return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
