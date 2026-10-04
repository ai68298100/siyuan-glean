import test from "node:test";
import assert from "node:assert/strict";
import {
    BACKUP_FORMAT,
    MAX_BACKUP_BYTES,
    backupFieldPatch,
    diffBackupAttrs,
    parseBackup,
    type BackupPackage,
} from "../src/domain/backup.ts";
import { ATTR } from "../src/domain/schema.ts";

const articleId = "20261004120000-aaaaaaa";
const notebookId = "20261004110000-nnnnnnn";

function manifest(): BackupPackage {
    return {
        format: BACKUP_FORMAT,
        version: 1,
        createdAt: "2026-10-04T04:00:00.000Z",
        pluginVersion: "1.1.0",
        documents: [{ id: articleId, title: "备份文章", box: notebookId, hpath: "/阅读/备份文章", attrs: { [ATTR.status]: "later" } }],
        settings: { version: 1 },
        uiPrefs: {},
        index: { version: 1, clips: {}, candidates: {} },
    };
}

function rejectsManifest(change: (backup: Record<string, any>) => void, error: RegExp): void {
    const backup = manifest();
    change(backup);
    assert.throws(() => parseBackup(JSON.stringify(backup)), error);
}

test("版本一 JSON 和 UTF-8 BOM 可解析，原始属性及派生快照不被改写", () => {
    const backup = manifest();
    backup.documents[0].attrs = {
        [ATTR.status]: "done",
        [ATTR.author]: "错误\n署名",
        [ATTR.priority]: "99",
        "custom-clip-old-extension": "\u0000旧扩展原始值",
    };
    backup.index = { version: 123, clips: { stale: { title: "仅为快照" } } };
    const content = JSON.stringify(backup);
    assert.deepEqual(parseBackup(content), backup);
    assert.deepEqual(parseBackup(`\uFEFF${content}`), backup);
    assert.deepEqual(parseBackup(content).documents[0].attrs, backup.documents[0].attrs);
});

for (const content of ["", "{", "{\"format\":}", "null", "[]", "true", "42", '"text"']) {
    test(`拒绝非 JSON 包或非对象根值：${JSON.stringify(content)}`, () => {
        assert.throws(() => parseBackup(content));
    });
}

test("根和文章结构缺键、未知键及导入授权字段均拒绝", () => {
    rejectsManifest((backup) => { delete backup.index; }, /Invalid backup structure/);
    rejectsManifest((backup) => { backup.confirmed = true; }, /Invalid backup structure/);
    rejectsManifest((backup) => { delete backup.documents[0].title; }, /Invalid backup structure/);
    rejectsManifest((backup) => { backup.documents[0].allowDuplicate = true; }, /Invalid backup structure/);
    rejectsManifest((backup) => { backup.documents[0] = null; }, /Invalid backup document/);
    rejectsManifest((backup) => { backup.documents = {}; }, /Invalid backup document count/);
});

for (const [field, value] of [["format", "another-backup"], ["version", 0], ["version", 2], ["version", "1"]] as const) {
    test(`拒绝不支持的格式或版本：${field}=${value}`, () => {
        rejectsManifest((backup) => { backup[field] = value; }, /Unsupported backup format or version/);
    });
}

test("创建时间必须可解析，文本和偏好必须具有契约类型", () => {
    rejectsManifest((backup) => { backup.createdAt = "not-a-date"; }, /Invalid backup date/);
    rejectsManifest((backup) => { backup.createdAt = 123; }, /Invalid backup text/);
    rejectsManifest((backup) => { backup.pluginVersion = null; }, /Invalid backup text/);
    rejectsManifest((backup) => { backup.documents[0].title = 123; }, /Invalid backup text/);
    for (const field of ["settings", "uiPrefs", "index"]) {
        for (const value of [null, [], "preferences"]) {
            rejectsManifest((backup) => { backup[field] = value; }, /Invalid backup preferences/);
        }
    }
});

test("文章和笔记本必须是合法根块 ID，重复 ID 不因标题或位置不同而放行", () => {
    for (const field of ["id", "box"]) {
        for (const value of ["", "doc-1", "20261004120000-AAAAAAA", "20261004120000-aaaaaa", "bad' OR 1=1"]) {
            rejectsManifest((backup) => { backup.documents[0][field] = value; }, /Invalid or duplicate backup ID/);
        }
    }
    rejectsManifest((backup) => {
        backup.documents.push({ ...backup.documents[0], title: "另一标题", hpath: "/其他/同一ID", box: "20261004110000-mmmmmmm" });
    }, /Invalid or duplicate backup ID/);
});

test("文章路径必须绝对，属性对象只允许 clip 字符串键值", () => {
    rejectsManifest((backup) => { backup.documents[0].hpath = "相对路径"; }, /Invalid backup document attributes/);
    for (const attrs of [null, [], "attrs"]) {
        rejectsManifest((backup) => { backup.documents[0].attrs = attrs; }, /Invalid backup document attributes/);
    }
    for (const key of ["tags", "custom-user-note", "custom-clip-\nkey", "custom-clip-\u200Bkey", `custom-clip-${"x".repeat(117)}`]) {
        rejectsManifest((backup) => { backup.documents[0].attrs[key] = "value"; }, /Invalid backup attribute key/);
    }
    for (const value of [null, 1, true, ["tag"], { author: "作者" }]) {
        rejectsManifest((backup) => { backup.documents[0].attrs[ATTR.author] = value; }, /Invalid backup text/);
    }
});

test("无有效状态和 internal 文档不可成为可恢复文章", () => {
    rejectsManifest((backup) => { delete backup.documents[0].attrs[ATTR.status]; }, /not a library article/);
    rejectsManifest((backup) => { backup.documents[0].attrs[ATTR.status] = "old-status"; }, /not a library article/);
    for (const internal of ["true", "TRUE"]) {
        rejectsManifest((backup) => { backup.documents[0].attrs[ATTR.internal] = internal; }, /not a library article/);
    }
});

test("文件 20 MiB 边界按 UTF-8 字节计，包括 BOM 和空白", () => {
    const content = JSON.stringify(manifest());
    const boundary = content + " ".repeat(MAX_BACKUP_BYTES - new TextEncoder().encode(content).length);
    assert.deepEqual(parseBackup(boundary), manifest());
    assert.throws(() => parseBackup(`${boundary} `), /Backup exceeds 20 MiB/);
    assert.throws(() => parseBackup(`\uFEFF${boundary}`), /Backup exceeds 20 MiB/);
    assert.throws(() => parseBackup(`"${"文".repeat(Math.ceil(MAX_BACKUP_BYTES / 3))}"`), /Backup exceeds 20 MiB/);
});

test("单属性 1 MiB 边界按字节计，超限不会以字符长度放行", () => {
    const backup = manifest();
    const boundary = "文".repeat(Math.floor(1024 * 1024 / 3)) + "x";
    assert.equal(new TextEncoder().encode(boundary).length, 1024 * 1024);
    backup.documents[0].attrs[ATTR.summary] = boundary;
    assert.equal(parseBackup(JSON.stringify(backup)).documents[0].attrs[ATTR.summary], boundary);
    backup.documents[0].attrs[ATTR.summary] += "x";
    assert.throws(() => parseBackup(JSON.stringify(backup)), /Invalid backup text/);
});

test("文章标题、版本文本和文章数执行各自上限，空库可以备份", () => {
    const backup = manifest();
    backup.documents[0].title = "文".repeat(21845) + "x";
    assert.equal(new TextEncoder().encode(backup.documents[0].title).length, 65536);
    assert.equal(parseBackup(JSON.stringify(backup)).documents[0].title, backup.documents[0].title);
    backup.documents[0].title += "x";
    assert.throws(() => parseBackup(JSON.stringify(backup)), /Invalid backup text/);
    rejectsManifest((input) => { input.pluginVersion = "x".repeat(101); }, /Invalid backup text/);
    rejectsManifest((input) => { input.createdAt = "x".repeat(101); }, /Invalid backup text/);
    rejectsManifest((input) => { input.documents = Array(50001).fill(null); }, /Invalid backup document count/);
    backup.documents = [];
    assert.deepEqual(parseBackup(JSON.stringify(backup)).documents, []);
});

test("未知设置版本保留给服务判定，不影响文章包的只读解析", () => {
    const backup = manifest();
    backup.settings.version = 2;
    assert.equal(parseBackup(JSON.stringify(backup)).settings.version, 2);
});

test("字段恢复保留类型和原值，显式 null 删除可恢复的已知键", () => {
    assert.deepEqual(backupFieldPatch(ATTR.author, "😀作者"), { author: "😀作者" });
    assert.deepEqual(backupFieldPatch(ATTR.status, "done"), { status: "done" });
    assert.deepEqual(backupFieldPatch(ATTR.priority, "5"), { priority: 5 });
    assert.deepEqual(backupFieldPatch(ATTR.rating, "0"), { rating: 0 });
    assert.deepEqual(backupFieldPatch(ATTR.words, "1200"), { words: 1200 });
    assert.deepEqual(backupFieldPatch(ATTR.aiTags, "阅读,编程"), { aiTags: ["阅读", "编程"] });
    assert.deepEqual(backupFieldPatch(ATTR.excluded, "true"), { excluded: true });
    assert.deepEqual(backupFieldPatch(ATTR.timeSource, "source"), { timeSource: "source" });
    assert.deepEqual(backupFieldPatch(ATTR.author, null), { author: null });
    assert.deepEqual(backupFieldPatch(ATTR.status, null), { status: null });
    assert.deepEqual(backupFieldPatch(ATTR.aiTags, null), { aiTags: null });
    assert.deepEqual(backupFieldPatch(ATTR.internal, null), { internal: null });
});

const unrestorable: Array<[string, string]> = [
    [ATTR.author, "错误\n署名"],
    [ATTR.author, " 作者 "],
    [ATTR.author, "😀".repeat(121)],
    [ATTR.priority, "99"],
    [ATTR.priority, "03"],
    [ATTR.rating, "-1"],
    [ATTR.rating, "6"],
    [ATTR.words, "1.5"],
    [ATTR.words, "NaN"],
    [ATTR.words, "1".repeat(400)],
    [ATTR.minutes, "01"],
    [ATTR.aiTags, "阅读, 编程"],
    [ATTR.summary, ""],
    [ATTR.excluded, "false"],
    [ATTR.excluded, "TRUE"],
    [ATTR.src, "legacy-source"],
    [ATTR.contentType, "unknown"],
    [ATTR.timeSource, "unknown"],
    ["custom-clip-old-extension", "原始值"],
];

test("非法旧值和需规范化的值完整备份，恢复不能悄悄改值或删除未知键", () => {
    const backup = manifest();
    Object.assign(backup.documents[0].attrs, Object.fromEntries(unrestorable));
    const parsed = parseBackup(JSON.stringify(backup));
    assert.deepEqual(parsed.documents[0].attrs, backup.documents[0].attrs);
    for (const [key, value] of unrestorable) assert.equal(backupFieldPatch(key, value), null, `${key}: ${value}`);
    assert.equal(backupFieldPatch("custom-clip-old-extension", null), null);
    assert.equal(backupFieldPatch("tags", "阅读"), null);
});

test("缺失字段默认选中，手填字段替换和删除需逐字段明确选择", () => {
    const current = { [ATTR.status]: "reading", [ATTR.author]: "手填作者", [ATTR.rating]: "5", tags: "用户标签" };
    const saved = { [ATTR.status]: "done", [ATTR.author]: "备份作者", [ATTR.priority]: "4", [ATTR.summary]: "恢复摘要" };
    const before = structuredClone({ current, saved });
    const diffs = diffBackupAttrs(current, saved);
    assert.deepEqual(diffs, [
        { key: ATTR.author, before: "手填作者", after: "备份作者", kind: "replace", supported: true, selected: false },
        { key: ATTR.priority, before: null, after: "4", kind: "add", supported: true, selected: true },
        { key: ATTR.rating, before: "5", after: null, kind: "delete", supported: true, selected: false },
        { key: ATTR.status, before: "reading", after: "done", kind: "replace", supported: true, selected: false },
        { key: ATTR.summary, before: null, after: "恢复摘要", kind: "add", supported: true, selected: true },
    ]);
    assert.deepEqual({ current, saved }, before);
});

test("五个手填字段仅在真正缺失时默认选中，空字符串也算已有值", () => {
    const saved = { [ATTR.url]: "https://example.test/article", [ATTR.status]: "later", [ATTR.author]: "作者", [ATTR.priority]: "4", [ATTR.rating]: "3" };
    const missing = diffBackupAttrs({}, saved);
    assert.equal(missing.length, 5);
    assert.ok(missing.every((field) => field.kind === "add" && field.supported && field.selected));
    const current = Object.fromEntries(Object.keys(saved).map((key) => [key, ""]));
    assert.ok(diffBackupAttrs(current, saved).every((field) => field.before === "" && field.kind === "replace" && !field.selected));
});

test("不支持的新增、替换和删除全部不选；未知键保留差异，用户 tags 不参与", () => {
    const diffs = diffBackupAttrs(
        { [ATTR.priority]: "4", "custom-clip-old-current": "不能删除", tags: "用户标签" },
        { [ATTR.priority]: "99", [ATTR.author]: "错误\n署名", "custom-clip-old-saved": "不能恢复" },
    );
    assert.deepEqual(diffs.map((field) => [field.key, field.kind]), [
        [ATTR.author, "add"], ["custom-clip-old-current", "delete"], ["custom-clip-old-saved", "add"], [ATTR.priority, "replace"],
    ]);
    assert.ok(diffs.every((field) => !field.supported && !field.selected));
    assert.deepEqual(diffBackupAttrs({ [ATTR.author]: "错误\n署名", tags: "新标签" }, { [ATTR.author]: "错误\n署名" }), []);
});
