/**
 * Markdown export rendering and small ZIP writer (T-3333/T-3335).
 * This module is pure: article facts arrive as a read-only projection and
 * no custom-clip attributes are serialized as an arbitrary IAL dump.
 */

export interface MarkdownArticleMeta {
    id: string;
    title: string;
    path: string;
    notebook: string;
    status: string;
    url: string;
    site: string;
    author: string;
    time: string;
    doneTime: string;
    source: string;
    contentType: string;
    tags: string[];
    aiTags: string[];
    summary: string;
}

export interface ArchiveFile {
    name: string;
    content: string;
}

export const ARCHIVE_PART_MAX_BYTES = 16 * 1024 * 1024;

function cleanLine(value: string): string {
    return value.replace(/[\u0000-\u001f\u007f\r\n]+/g, " ").trim();
}

function yamlString(value: string): string {
    return JSON.stringify(cleanLine(value));
}

function yamlList(values: readonly string[]): string {
    return `[${values.map((value) => yamlString(value)).join(", ")}]`;
}

/** Render a single article with a stable, human-readable metadata frontmatter. */
export function renderArticleMarkdown(meta: MarkdownArticleMeta, body: string): string {
    const title = cleanLine(meta.title) || "未命名文章";
    const lines = [
        "---",
        `title: ${yamlString(title)}`,
        `id: ${yamlString(meta.id)}`,
        `path: ${yamlString(meta.path)}`,
        `notebook: ${yamlString(meta.notebook)}`,
        `status: ${yamlString(meta.status)}`,
        `url: ${yamlString(meta.url)}`,
        `site: ${yamlString(meta.site)}`,
        `author: ${yamlString(meta.author)}`,
        `time: ${yamlString(meta.time)}`,
        `done_time: ${yamlString(meta.doneTime)}`,
        `source: ${yamlString(meta.source)}`,
        `content_type: ${yamlString(meta.contentType)}`,
        `tags: ${yamlList(meta.tags)}`,
        `ai_tags: ${yamlList(meta.aiTags)}`,
        `summary: ${yamlString(meta.summary)}`,
        "---",
        "",
        `# ${title}`,
        "",
    ];
    const normalizedBody = body.replace(/^\uFEFF/, "").trim();
    if (normalizedBody) lines.push(normalizedBody, "");
    return `${lines.join("\n")}\n`;
}

function slug(value: string): string {
    const normalized = value.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim();
    return (normalized.replace(/\s+/g, "-").slice(0, 80) || "untitled");
}

export function archiveArticlePath(index: number, meta: Pick<MarkdownArticleMeta, "id" | "title">): string {
    const ordinal = String(index + 1).padStart(5, "0");
    return `articles/${ordinal}-${slug(meta.title)}-${meta.id}.md`;
}

export function articleMarkdownFilename(meta: Pick<MarkdownArticleMeta, "id" | "title">): string {
    return `${slug(meta.title)}-${meta.id}.md`;
}

export function renderArchiveIndex(entries: readonly (MarkdownArticleMeta & { file: string })[], generatedAt: string, failures: readonly { id: string; reason: string }[] = []): string {
    return `${JSON.stringify({
        format: 1,
        generatedAt,
        description: "小驴拾遗 Markdown 全库归档索引",
        count: entries.length,
        entries: entries.map(({ file, ...meta }) => ({ file, ...meta })),
        failures,
    }, null, 2)}\n`;
}

function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Build a standards-compatible ZIP using stored entries. Stored entries avoid
 * a second copy of the body in a compressor and work in older embedded WebViews.
 */
export function buildStoredZip(files: readonly ArchiveFile[]): Uint8Array {
    const encoder = new TextEncoder();
    const prepared = files.map((file) => {
        const name = encoder.encode(file.name);
        const data = encoder.encode(file.content);
        if (name.length > 0xffff || data.length > 0xffffffff) throw new Error("Archive entry exceeds ZIP limits");
        return { name, data, crc: crc32(data) };
    });
    let localSize = 0;
    let centralSize = 0;
    for (const entry of prepared) {
        localSize += 30 + entry.name.length + entry.data.length;
        centralSize += 46 + entry.name.length;
    }
    const result = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(result.buffer);
    let cursor = 0;
    const write16 = (value: number) => { view.setUint16(cursor, value, true); cursor += 2; };
    const write32 = (value: number) => { view.setUint32(cursor, value, true); cursor += 4; };
    const centralOffset = localSize;
    const centralRecords: Array<{ entry: typeof prepared[number]; offset: number }> = [];
    for (const entry of prepared) {
        const localOffset = cursor;
        write32(0x04034b50); write16(20); write16(0x800); write16(0); write16(0); write16(0);
        write32(entry.crc); write32(entry.data.length); write32(entry.data.length); write16(entry.name.length); write16(0);
        result.set(entry.name, cursor); cursor += entry.name.length;
        result.set(entry.data, cursor); cursor += entry.data.length;
        centralRecords.push({ entry, offset: localOffset });
    }
    for (const { entry, offset } of centralRecords) {
        write32(0x02014b50); write16(20); write16(20); write16(0x800); write16(0); write16(0); write16(0);
        write32(entry.crc); write32(entry.data.length); write32(entry.data.length); write16(entry.name.length);
        write16(0); write16(0); write16(0); write16(0); write32(0); write32(offset);
        result.set(entry.name, cursor); cursor += entry.name.length;
    }
    write32(0x06054b50); write16(0); write16(0); write16(prepared.length); write16(prepared.length);
    write32(centralSize); write32(centralOffset); write16(0);
    return result;
}

export function estimateZipEntryBytes(file: ArchiveFile): number {
    const encoder = new TextEncoder();
    return encoder.encode(file.name).length * 2 + encoder.encode(file.content).length + 76;
}
