/**
 * 资产与快照 API（T-1504，契约内核源码核实）：
 * - exportHTML：请求 {id, pdf} → data {name, content}（savePath 留空走临时目录并回传内容字符串）
 * - putFile：multipart/form-data（path + file），宿主 fetchPost 原生透传 FormData
 *   （app/src/util/fetch.ts:35，apicontract/file.go:5-11 PutFileRequest）
 */
import { fetchPost } from "siyuan";
import { KERNEL_TIMEOUT_LONG_MS, kernelPost } from "./client";

export interface ExportHtmlResult {
    name: string;
    content: string;
}

/** 导出文档为单文件 HTML（内容字符串）。大文档导出放宽超时（T-1967）。 */
export async function exportDocHtml(id: string): Promise<ExportHtmlResult> {
    return kernelPost<ExportHtmlResult>("/api/export/exportHTML", { id, pdf: false }, { timeoutMs: KERNEL_TIMEOUT_LONG_MS });
}

/** 工作区相对路径写入文件（如 /assets/xxx.html）。multipart 上传，返回 code!=0 时抛错。大文件放宽超时。 */
export async function putFile(path: string, blob: Blob, filename: string): Promise<void> {
    const form = new FormData();
    form.append("path", path);
    form.append("file", blob, filename);
    await new Promise<void>((resolve, reject) => {
        let settled = false;
        // T-1967：大 HTML 快照上传放宽到长超时
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error(`putFile 请求超时（${Math.round(KERNEL_TIMEOUT_LONG_MS / 1000)}s 无响应）`));
        }, KERNEL_TIMEOUT_LONG_MS);
        fetchPost("/api/file/putFile", form, (response: { code?: number; msg?: string }) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (response && typeof response.code === "number" && response.code !== 0) {
                reject(new Error(`putFile code=${response.code} msg=${response.msg || ""}`));
            } else {
                resolve();
            }
        });
    });
}
