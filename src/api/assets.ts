/**
 * 资产与快照 API（T-1504，契约内核源码核实）：
 * - exportHTML：请求 {id, pdf} → data {name, content}（savePath 留空走临时目录并回传内容字符串）
 * - putFile：multipart/form-data（path + file），宿主 fetchSyncPost 原生透传 FormData
 *   （app/src/util/fetch.ts:35，apicontract/file.go:5-11 PutFileRequest）
 */
import { kernelPost } from "./client";

export interface ExportHtmlResult {
    name: string;
    content: string;
}

/** 导出文档为单文件 HTML（内容字符串）。 */
export async function exportDocHtml(id: string): Promise<ExportHtmlResult> {
    const data = await kernelPost<ExportHtmlResult>("/api/export/exportHTML", { id, pdf: false });
    if (!data || typeof data.content !== "string") throw new Error("快照导出响应缺少 HTML 正文");
    return data;
}

/** 工作区相对路径写入文件（如 /assets/xxx.html）。multipart 上传，返回 code!=0 时抛错。 */
export async function putFile(path: string, blob: Blob, filename: string): Promise<void> {
    const form = new FormData();
    form.append("path", path);
    form.append("file", blob, filename);
    await kernelPost<void>("/api/file/putFile", form);
}
