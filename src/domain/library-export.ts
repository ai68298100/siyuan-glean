export interface LibraryExportRow {
    id: string;
    title: string;
    path: string;
    notebook: string;
    status: string;
    url: string;
    site: string;
    author?: string;
    time: string;
    doneTime: string;
    words: number | string;
    minutes: number | string;
    priority: number | string;
    rating: number | string;
    source: string;
    contentType: string;
    timeSource: string;
    lastSurfaced: string;
    pinned: string;
    userTags: string[];
    aiTags: string[];
    summary: string;
    snapshot: string;
    readingPosition?: string;
}

const HEADERS = [
    "id", "title", "path", "notebook", "status", "url", "site", "author", "time", "doneTime",
    "words", "minutes", "priority", "rating", "source", "contentType", "timeSource", "lastSurfaced", "pinned",
    "userTags", "aiTags", "summary", "snapshot", "readingPosition",
] as const;

function protectFormula(value: string): string {
    return /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
}

export function csvCell(value: unknown): string {
    const text = protectFormula(value === undefined || value === null ? "" : String(value));
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function renderLibraryCsv(rows: readonly LibraryExportRow[]): string {
    const output = [HEADERS.join(",")];
    for (const row of rows) {
        output.push([
            row.id, row.title, row.path, row.notebook, row.status, row.url, row.site, row.author, row.time, row.doneTime,
            row.words, row.minutes, row.priority, row.rating, row.source, row.contentType, row.timeSource, row.lastSurfaced, row.pinned,
            row.userTags.join(" | "), row.aiTags.join(" | "), row.summary, row.snapshot, row.readingPosition,
        ].map(csvCell).join(","));
    }
    return `\uFEFF${output.join("\r\n")}\r\n`;
}
