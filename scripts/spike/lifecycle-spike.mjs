/* T-1868 生命周期 spike：在隔离内核实证「归档宿主移动 + 两级删除」要用的内核端点（D-0032 / DATA-CONTRACT §7）。
   端点形状不臆造——本脚本在隔离工作区实测：SQL path 列、moveDocs 移动不变式与幂等、
   removeDoc 删除语义与失败响应、重名路径行为。产出 scripts/spike/lifecycle-spike-results.json。
   移动/删除全部只发生在 GleanSpike 笔记本的测试文档上，绝不触碰用户真实笔记。 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
    resolveKernel,
    prepareWorkspace,
    assertTestPortAvailable,
    startKernel,
    createApiClient,
    waitForBoot,
    shutdownKernel,
} from "./kernel-harness.mjs";

const WORKSPACE = path.join(os.homedir(), "SiYuan-Glean-Spike");
const HOST = "127.0.0.1";
const PORT = 6833;
const BASE = `http://${HOST}:${PORT}`;

const results = [];
const record = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/** 轮询直到条件成立或超时（内核索引异步刷新）。 */
async function until(fn, timeoutMs = 8000, label = "条件") {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = await fn().catch(() => undefined);
        if (value) return value;
        await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`等待超时：${label}`);
}

async function main() {
    const { kernel, appDir } = resolveKernel();
    prepareWorkspace(WORKSPACE, "glean-spike.json", "glean-spike");
    await assertTestPortAvailable(HOST, PORT);
    const client = createApiClient(BASE);
    const { child, lines } = startKernel(kernel, appDir, WORKSPACE, PORT);
    client.onGuard(() => {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error("测试内核已退出");
    });

    let exitCode = 0;
    let booted = false;
    try {
        const version = await waitForBoot(BASE, lines, () => {
            if (child.exitCode !== null || child.signalCode !== null) throw new Error("测试内核已退出");
        }, client);
        booted = true;
        console.log(`内核 ${JSON.stringify(version)} @ ${BASE}\n`);
        client.setToken((JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf", "conf.json"), "utf8")).accessAuthCode) || "");
        const { apiChecked, api } = client;

        // 桌面信任门槛 + 笔记本（每轮重建，防上轮残留重名文档污染 blocktree）
        await api("/api/setting/setBazaar", { trust: true, petalDisabled: false });
        const notebooks = await apiChecked("/api/notebook/lsNotebooks", {});
        const stale = (notebooks.notebooks || []).find((n) => n.name === "GleanSpike");
        if (stale) await api("/api/notebook/removeNotebook", { notebook: stale.id });
        await apiChecked("/api/notebook/createNotebook", { name: "GleanSpike" });
        const refreshed = await apiChecked("/api/notebook/lsNotebooks", {});
        const notebookID = (refreshed.notebooks || []).find((n) => n.name === "GleanSpike")?.id;

        /* ---------- 准备：宿主【归档】+ 文章A（全属性+子块）+ 文章B ---------- */
        const hostId = await apiChecked("/api/filetree/createDocWithMd", {
            notebook: notebookID, path: "/【归档】", markdown: "# 【归档】\n\n归档宿主",
        });
        const docA = await apiChecked("/api/filetree/createDocWithMd", {
            notebook: notebookID, path: "/文章A", markdown: "# 文章A\n\n正文段落\n\n> 引述块子内容",
        });
        const docB = await apiChecked("/api/filetree/createDocWithMd", {
            notebook: notebookID, path: "/文章B", markdown: "# 文章B\n\n待删除正文",
        });
        await apiChecked("/api/attr/setBlockAttrs", {
            id: docA,
            attrs: { "custom-clip-status": "archived", "custom-clip-url": "https://example.com/a", "custom-clip-site": "example.com" },
        });
        const attrBefore = await apiChecked("/api/attr/getBlockAttrs", { id: docA });

        /* ---------- ① SQL path 列形状 ---------- */
        const rowA = await until(async () => {
            const rows = await apiChecked("/api/query/sql", {
                stmt: `SELECT id, path, hpath, box FROM blocks WHERE type='d' AND id='${docA}'`,
            });
            return rows[0]?.path ? rows[0] : undefined;
        }, 8000, "文章A path 列出现");
        const pathOk = /^\/.+\.sy$/.test(rowA.path) && rowA.hpath === "/文章A" && rowA.box === notebookID;
        record("① blocks.path 列形状（.sy 相对路径 + hpath + box）", pathOk, `path=${rowA.path} hpath=${rowA.hpath} box=${rowA.box}`);

        /* ---------- ② moveDocs 移动到宿主下：ID/属性/子块保留 + hpath 变更 + 幂等 ---------- */
        const hostRow = await until(async () => {
            const rows = await apiChecked("/api/query/sql", {
                stmt: `SELECT id, path FROM blocks WHERE type='d' AND id='${hostId}'`,
            });
            return rows[0]?.path ? rows[0] : undefined;
        }, 8000, "宿主 path 列出现");
        // toPath 形态试探：目标父目录的 ID 路径有三种可能写法，逐个实测记录生效形态
        const toPathCandidates = [
            ["目录路径(去.sy)", hostRow.path.replace(/\.sy$/, "")],
            ["完整文档path(带.sy)", hostRow.path],
            ["根路径", "/"],
        ];
        let moveResp = null;
        let usedForm = "";
        let usedToPath = "";
        for (const [label, toPath] of toPathCandidates) {
            const resp = await api("/api/filetree/moveDocs", {
                fromPaths: [rowA.path], toNotebook: notebookID, toPath,
            });
            // 探测行：探明该形态被接受还是拒绝，本身就是实证结论（失败≠脚本失败）
            record(`②-p ${label}: toPath=${toPath}`, true,
                resp.code === 0 ? `被接受 code=0` : `被拒 code=${resp.code} msg="${resp.msg}"`);
            if (resp.code === 0) { moveResp = resp; usedForm = label; usedToPath = toPath; break; }
        }
        const moveOk = moveResp?.code === 0;
        let moveDetail = `moveDocs code=${moveResp.code} msg=${moveResp.msg} data=${JSON.stringify(moveResp.data)}`;
        if (moveOk) {
            const after = await until(async () => {
                const rows = await apiChecked("/api/query/sql", {
                    stmt: `SELECT id, path, hpath FROM blocks WHERE type='d' AND id='${docA}'`,
                });
                return rows[0]?.hpath === "/【归档】/文章A" ? rows[0] : undefined;
            }, 8000, "hpath 更新为宿主下");
            const attrAfter = await apiChecked("/api/attr/getBlockAttrs", { id: docA });
            const attrsKept = attrAfter["custom-clip-status"] === "archived"
                && attrAfter["custom-clip-url"] === "https://example.com/a"
                && attrAfter["custom-clip-site"] === "example.com";
            const childText = await apiChecked("/api/query/sql", {
                stmt: `SELECT count(*) AS n FROM blocks WHERE root_id='${docA}' AND type='p'`,
            });
            const contentKept = Number(childText[0]?.n ?? 0) >= 1;
            const moveAgain = await api("/api/filetree/moveDocs", {
                fromPaths: [after.path], toNotebook: notebookID, toPath: usedToPath,
            });
            const idempotent = moveAgain.code === 0;
            moveDetail = `生效形态=${usedForm} ID不变=${after.id === docA} 属性保留=${attrsKept} 正文保留=${contentKept} `
                + `hpath=${after.hpath} 重复移动code=${moveAgain.code}`;
            record("② moveDocs 移动不变式（ID/属性/正文/hpath）+ 重复移动幂等",
                after.id === docA && attrsKept && contentKept && idempotent, moveDetail);
        } else {
            record("② moveDocs 移动不变式（ID/属性/正文/hpath）+ 重复移动幂等", false, moveDetail);
        }

        /* ---------- ③ removeDoc 删除语义 ---------- */
        const rowB = await apiChecked("/api/query/sql", {
            stmt: `SELECT path FROM blocks WHERE type='d' AND id='${docB}'`,
        });
        const delResp = await api("/api/filetree/removeDoc", { notebook: notebookID, path: rowB[0]?.path });
        let docGone = false;
        try {
            docGone = await until(async () => {
                const rows = await apiChecked("/api/query/sql", {
                    stmt: `SELECT count(*) AS n FROM blocks WHERE root_id='${docB}'`,
                });
                return Number(rows[0]?.n ?? 0) === 0;
            }, 8000, "文章B 从索引消失");
        } catch { docGone = false; }
        const attrGone = await api("/api/attr/getBlockAttrs", { id: docB });
        // 文档真实存在性判据：createDocWithMd 同路径能否复用（索引 vs 文件系统双视角）
        const recreate = await api("/api/filetree/createDocWithMd", { notebook: notebookID, path: "/文章B", markdown: "# 重建探测" });
        record("③ removeDoc 删除（索引消失 + 属性端点响应 + 同路径重建探测）", delResp.code === 0 && docGone,
            `removeDoc code=${delResp.code} msg="${delResp.msg}" 索引清空=${docGone} `
            + `删后 getBlockAttrs code=${attrGone.code} data=${JSON.stringify(attrGone.data)?.slice(0, 60)} `
            + `同路径重建 code=${recreate.code} 新ID=${recreate.data || "无"}`);

        /* ---------- ④ 失败语义（重试保护依据） ---------- */
        const delMissing = await api("/api/filetree/removeDoc", { notebook: notebookID, path: "/不存在-XYZ.sy" });
        const moveMissing = await api("/api/filetree/moveDocs", {
            fromPaths: ["/不存在-XYZ.sy"], toNotebook: notebookID, toPath: "/【归档】",
        });
        record("④ 删除/移动不存在路径的响应（code!=0 或静默？记录供重试保护）",
            true, `removeDoc(不存在) code=${delMissing.code} msg=${delMissing.msg}；moveDocs(不存在) code=${moveMissing.code} msg=${moveMissing.msg}`);

        /* ---------- ⑤ 重名路径行为（createDocWithMd 同名） ---------- */
        const dup = await api("/api/filetree/createDocWithMd", { notebook: notebookID, path: "/【归档】", markdown: "# 重名" });
        const dupRow = dup.code === 0 && dup.data
            ? await apiChecked("/api/query/sql", { stmt: `SELECT id, hpath FROM blocks WHERE type='d' AND id='${dup.data}'` })
            : [];
        record("⑤ 同路径重名 createDocWithMd 行为", true,
            `code=${dup.code} data=${JSON.stringify(dup.data)} 新块hpath=${dupRow[0]?.hpath ?? "（未创建）"}`);

        const failures = results.filter((r) => !r.ok);

        /* ---------- ⑥ 移出宿主到根目录（T-1872 恢复策略依赖）：toPath="/" 实证 ---------- */
        // 前置：文章A 已在 /【归档】下（②移动过）；把它移回根目录
        const rowAAgain = await apiChecked("/api/query/sql", {
            stmt: `SELECT path FROM blocks WHERE type='d' AND id='${docA}'`,
        });
        const moveRoot = await api("/api/filetree/moveDocs", {
            fromPaths: [rowAAgain[0]?.path ?? ""], toNotebook: notebookID, toPath: "/",
        });
        let rootOk = moveRoot.code === 0;
        if (rootOk) {
            try {
                await until(async () => {
                    const rows = await apiChecked("/api/query/sql", {
                        stmt: `SELECT hpath FROM blocks WHERE type='d' AND id='${docA}'`,
                    });
                    return rows[0]?.hpath === "/文章A" ? true : null;
                }, 8000, "移回根后 hpath 收敛");
            } catch { rootOk = false; }
        }
        record("⑥ moveDocs toPath=\"/\" 移动到根目录（移出宿主依赖）", rootOk,
            `code=${moveRoot.code} msg="${moveRoot.msg}" hpath回到根=${rootOk}`);

        exitCode = failures.length > 0 ? 1 : 0;
        fs.writeFileSync(
            path.join(process.cwd(), "scripts", "spike", "lifecycle-spike-results.json"),
            `${JSON.stringify({ version: version.version, at: new Date().toISOString(), results }, null, 2)}\n`
        );
        console.log(`\n== lifecycle spike 完成：${results.length - failures.length}/${results.length} 通过 ==`);
    } finally {
        if (booted) await shutdownKernel(client, child);
    }
    process.exit(exitCode);
}

main().catch((error) => {
    console.error("SPIKE ERROR:", error.message);
    process.exit(2);
});
