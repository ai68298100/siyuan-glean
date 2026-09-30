/** 归档生命周期纯函数（T-1869/1870/1871，D-0032）：路径计算与判定。 */
import test from "node:test";
import assert from "node:assert/strict";

import {
    ARCHIVE_HOST_TITLE,
    RECYCLE_HOST_TITLE,
    parentFolderOf,
    hostHpathOf,
    isUnderHost,
    isHostItself,
    buildPurgeInfo,
    canPurge,
} from "../src/domain/lifecycle.ts";

test("parentFolderOf：父目录提取与根级文档", () => {
    assert.equal(parentFolderOf("/收集/深度/文章A"), "/收集/深度");
    assert.equal(parentFolderOf("/文章A"), "");
    assert.equal(parentFolderOf(""), "");
    // 反斜杠路径归一为斜杠
    assert.equal(parentFolderOf("\\收集\\文章A"), "/收集");
});

test("hostHpathOf：宿主与文章同目录（根级挂根、子文件夹挂本文件夹）", () => {
    assert.equal(hostHpathOf("/文章A", "archive"), "/【归档】");
    assert.equal(hostHpathOf("/收集/深度/文章A", "archive"), "/收集/深度/【归档】");
    assert.equal(hostHpathOf("/文章A", "recycle"), "/【回收】");
    assert.equal(hostHpathOf("/收集/文章B", "recycle"), "/收集/【回收】");
    // 嵌宿主边界（§7.1）：已在【归档】下的文章其【回收】宿主为宿主内同级，不追忆原路径
    assert.equal(hostHpathOf("/收集/【归档】/文章C", "recycle"), "/收集/【归档】/【回收】");
});

test("isUnderHost：宿主下任一层级的文档都算（幂等 no-op 判据）", () => {
    assert.equal(isUnderHost("/【归档】/文章A", "archive"), true);
    assert.equal(isUnderHost("/收集/【归档】/文章A", "archive"), true);
    assert.equal(isUnderHost("/收集/文章A", "archive"), false);
    // 归档宿主下的文档不算在回收宿主下
    assert.equal(isUnderHost("/【归档】/文章A", "recycle"), false);
    assert.equal(isUnderHost("/【回收】/文章B", "recycle"), true);
});

test("isHostItself：仅宿主标题本身判真，普通同名文章不受影响", () => {
    assert.equal(isHostItself("/收集/【归档】", "【归档】"), true);
    assert.equal(isHostItself("/【回收】", "【回收】"), true);
    assert.equal(isHostItself("/收集/文章A", "文章A"), false);
    assert.equal(isHostItself("/", ARCHIVE_HOST_TITLE), false);
});

test("buildPurgeInfo + canPurge：确认信息最小集合（§7.3）", () => {
    const info = buildPurgeInfo({ id: "20260101000000-aaaaaaa", title: "", box: "box1", hpath: "/收集/文章A", url: "https://example.com" });
    assert.equal(info.title, "未命名文档");
    assert.equal(info.url, "https://example.com");
    assert.equal(canPurge(info), true);
    assert.equal(canPurge(buildPurgeInfo({ id: "x", title: "t", box: "", hpath: "/a" })), false);
    assert.equal(canPurge(buildPurgeInfo({ id: "x", title: "t", box: "b", hpath: "" })), false);
});

test("宿主标题常量：与契约/D-0032 文字一致", () => {
    assert.equal(ARCHIVE_HOST_TITLE, "【归档】");
    assert.equal(RECYCLE_HOST_TITLE, "【回收】");
});
