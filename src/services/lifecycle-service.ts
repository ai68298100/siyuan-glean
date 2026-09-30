/**
 * 归档生命周期服务（T-1869/1870/1871，D-0032 / DATA-CONTRACT §7）。
 * 移动即可逆：【归档】/【回收】宿主在文章同目录幂等创建；移动保留根块 ID/属性/正文。
 * 两级删除：「删除」默认移入【回收】宿主（状态写 archived 退出活动队列，可随时移回）；
 * 「彻底删除」为二级动作——重查 ID+path 配对防误删同名新文档，索引必须清理；
 * 快照资产/AV 行/外部打卡历史按契约保留（§7.3），插件不代用户清理。
 */
import type { Plugin } from "siyuan";
import { createDocWithMd, getBlockAttrs, moveDocs, querySql, removeDoc, setBlockAttrs } from "../api/client";
import { ATTR } from "../domain/schema";
import { hostHpathOf, hostParentFolderOf, hostTitleOf, isUnderHost, isHostItself, type HostKind } from "../domain/lifecycle";
import { writeClip } from "./clip-store";
import { loadIndex, removeDocFromIndex, saveIndex, withIndexLock } from "./index-store";

interface DocRow {
    id: string;
    /** `/<timestamp>-<id>.sy` 形态（blocks.path 列，T-1868 实证） */
    path: string;
    hpath: string;
    box: string;
    title: string;
}

const sqlSafe = (value: string) => value.replace(/'/g, "''");

/** SQL 读文档当前路径四元组（索引异步——移动后轮询此查询收敛）。 */
async function docRow(docId: string): Promise<DocRow | null> {
    const rows = await querySql<DocRow>(
        `SELECT id, path, hpath, box, content AS title FROM blocks WHERE type = 'd' AND id = '${sqlSafe(docId)}' LIMIT 1`
    );
    return rows[0] ?? null;
}

async function untilSettled<T>(probe: () => Promise<T | undefined | null>, timeoutMs = 8000, label = "索引收敛"): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = await probe().catch(() => undefined);
        if (value !== undefined && value !== null) return value;
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`等待超时：${label}`);
}

/** 同目录同名宿主查找（T-1869：同路径 createDocWithMd 静默新建不幂等，必须先 SQL 查）。 */
async function findHost(box: string, hostHpath: string): Promise<DocRow | null> {
    const rows = await querySql<DocRow>(
        `SELECT id, path, hpath, box, content AS title FROM blocks WHERE type = 'd' AND box = '${sqlSafe(box)}' AND hpath = '${sqlSafe(hostHpath)}' LIMIT 1`
    );
    return rows[0] ?? null;
}

/**
 * 宿主幂等创建（T-1869）：同目录已有同名文档即复用（不校验是否插件所建——用户手动建的
 * 同名文件夹视作同一宿主）；无则创建并写 `custom-clip-internal=true`（§7.4 扫描豁免双保险）。
 * 返回宿主行（path 供 moveDocs 的 toPath 用，必须带 `.sy`）。
 */
export async function ensureHost(box: string, currentHpath: string, kind: HostKind): Promise<DocRow> {
    const hostHpath = hostHpathOf(currentHpath, kind);
    const existing = await findHost(box, hostHpath);
    if (existing) return existing;
    const markdown = `# ${hostTitleOf(kind)}\n\n由小驴拾遗创建的宿主文档，收录已归档文章。`;
    const hostId = await createDocWithMd(box, hostHpath, markdown);
    if (!hostId) throw new Error("宿主文档创建失败（无返回 ID）");
    await setBlockAttrs(hostId, { [ATTR.internal]: "true" });
    return untilSettled(async () => {
        const row = await docRow(hostId);
        return row?.path ? row : null;
    }, 8000, "宿主索引收敛");
}

export interface MoveResult {
    /** false = 已在宿主下，幂等 no-op（状态仍会确保写入） */
    moved: boolean;
    hostHpath: string;
}

/**
 * 归档移动语义（T-1870）：把文章移到其所在文件夹的宿主下，保留 ID/属性/正文/快照/引用；
 * 成功后写 `archived`（经 writeClip，索引 hpath/status 一并定向刷新，§7.2）。
 * 重复执行幂等：已在宿主下时不再移动，仅确保状态。
 * 回收（recycle）共用此路径：目标宿主为【回收】，状态同样写 archived（D-0032 两级删除）。
 */
export async function moveDocToHost(plugin: Plugin, docId: string, kind: HostKind): Promise<MoveResult> {
    const row = await docRow(docId);
    if (!row) throw new Error("文档不存在或索引未同步，无法执行归档移动");
    if (isHostItself(row.hpath, row.title)) throw new Error("宿主文档自身不能被移动");
    const hostHpath = hostHpathOf(row.hpath, kind);
    let moved = false;
    if (!isUnderHost(row.hpath, kind)) {
        const host = await ensureHost(row.box, row.hpath, kind);
        await moveDocs([row.path], row.box, host.path);
        // 内核移动为异步索引刷新：轮询确认 hpath 已落到宿主下（§7.2 收敛判据）
        await untilSettled(async () => {
            const after = await docRow(docId);
            return after && isUnderHost(after.hpath, kind) ? after : null;
        }, 8000, "移动后索引收敛");
        moved = true;
    }
    // 状态写 archived：显式用户动作（forceStatus）；writeClip 内部按最新 hpath 刷新索引投影
    await writeClip(plugin, docId, { status: "archived" }, { forceStatus: true });
    return { moved, hostHpath };
}

/** 归档后处理·移入【归档】宿主（T-1866 三选项之一的服务层）。 */
export async function archiveMoveDoc(plugin: Plugin, docId: string): Promise<MoveResult> {
    return moveDocToHost(plugin, docId, "archive");
}

/** 删除（默认语义）：移入同目录【回收】宿主，可随时人工移回。 */
export async function recycleDoc(plugin: Plugin, docId: string): Promise<MoveResult> {
    return moveDocToHost(plugin, docId, "recycle");
}

export interface PurgeResult {
    removed: boolean;
    /** 删除前快照，供确认回执与审计文案（§7.3） */
    title: string;
    hpath: string;
}

/**
 * 彻底删除（二级动作，T-1871）：内核 removeDoc 不可逆。删除前重查该 path 下的文档 ID
 * 仍为调用方传入的 docId（T-1868 实证：同路径可立即重建新 ID，防误删同名新文档）；
 * 成功后必须清理索引条目（防幽灵/URL 查重误报/候选复活）。失败抛出，不伪报成功。
 */
export async function purgeDoc(plugin: Plugin, docId: string): Promise<PurgeResult> {
    const row = await untilSettled(async () => {
        const current = await docRow(docId);
        return current && current.id === docId && current.path ? current : null;
    }, 4000, "删除前文档确认");
    if (isHostItself(row.hpath, row.title)) throw new Error("宿主文档不能被彻底删除，请先清空其下文章");
    await removeDoc(row.box, row.path);
    const gone = await untilSettled(async () => {
        const check = await docRow(docId);
        return check ? null : true;
    }, 8000, "删除后索引收敛");
    if (!gone) throw new Error("删除后索引仍可见，已中止回执（请稍后重试对账）");
    await withIndexLock(async () => {
        const index = await loadIndex(plugin);
        removeDocFromIndex(index, docId);
        await saveIndex(plugin, index);
    });
    return { removed: true, title: row.title, hpath: row.hpath };
}

/** 删除前确认信息（§7.3：标题/笔记本/路径/来源；UI 据此构造确认框）。 */
export async function buildDocPurgeInfo(docId: string): Promise<{ title: string; box: string; hpath: string; url: string } | null> {
    const row = await docRow(docId);
    if (!row) return null;
    const attrs = await getBlockAttrs(docId).catch(() => ({}) as Record<string, string>);
    return { title: row.title, box: row.box, hpath: row.hpath, url: attrs[ATTR.url] ?? "" };
}

/** 文章当前所在宿主类型（恢复分流判据，T-1872）；不在宿主下返回 null。 */
export async function docUnderHostKind(docId: string): Promise<HostKind | null> {
    const row = await docRow(docId);
    if (!row) return null;
    if (isUnderHost(row.hpath, "archive")) return "archive";
    if (isUnderHost(row.hpath, "recycle")) return "recycle";
    return null;
}

/** 对话框可发现性上下文（T-1876）：当前位置/宿主判定/归档移入目标/移出宿主目标。 */
export interface DocHostContext {
    title: string;
    hpath: string;
    hostKind: HostKind | null;
    /** 移入【归档】将使用的 hpath（hostHpathOf） */
    archiveTarget: string;
    /** 移出宿主的目标目录（hostParentFolderOf）；null=不在宿主下，""=根 */
    moveOutTarget: string | null;
}

export async function docHostContext(docId: string): Promise<DocHostContext | null> {
    const row = await docRow(docId);
    if (!row) return null;
    return {
        title: row.title,
        hpath: row.hpath,
        hostKind: isUnderHost(row.hpath, "archive") ? "archive" : isUnderHost(row.hpath, "recycle") ? "recycle" : null,
        archiveTarget: hostHpathOf(row.hpath, "archive"),
        moveOutTarget: hostParentFolderOf(row.hpath),
    };
}

/**
 * 恢复并移出宿主（T-1872）：把文章移动回宿主所在文件夹（目标可从当前位置推导，
 * 无"原路径"隐式状态）。已在宿主外时 no-op（moved=false）。状态由调用方另行写入。
 */
export async function moveDocOutOfHost(docId: string): Promise<MoveResult> {
    const row = await docRow(docId);
    if (!row) throw new Error("文档不存在或索引未同步，无法移出宿主");
    if (isHostItself(row.hpath, row.title)) throw new Error("宿主文档自身不能被移出");
    const target = hostParentFolderOf(row.hpath);
    if (target === null) return { moved: false, hostHpath: row.hpath };
    // 目标父目录对应的文档 path（带 .sy）；根目录用 "/"（T-1868 补充实证：moveDocs toPath="/" 合法）
    let toPath = "/";
    if (target !== "") {
        const parentRows = await querySql<{ path: string }>(
            `SELECT path FROM blocks WHERE type = 'd' AND box = '${sqlSafe(row.box)}' AND hpath = '${sqlSafe(target)}' LIMIT 1`
        );
        toPath = parentRows[0]?.path ?? "";
        if (!toPath) throw new Error(`目标文件夹不存在：${target}`);
    }
    await moveDocs([row.path], row.box, toPath);
    await untilSettled(async () => {
        const after = await docRow(docId);
        return after && !isUnderHost(after.hpath, "archive") && !isUnderHost(after.hpath, "recycle") ? after : null;
    }, 8000, "移出宿主后索引收敛");
    return { moved: true, hostHpath: target };
}
