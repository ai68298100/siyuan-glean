import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const guide = readFileSync(resolve(root, "docs/INTEGRATION-ACCEPTANCE.md"), "utf8");
const importService = readFileSync(resolve(root, "src/services/import-service.ts"), "utf8");
const importers = readFileSync(resolve(root, "src/domain/importers.ts"), "utf8");
const inboxApi = readFileSync(resolve(root, "src/api/inbox.ts"), "utf8");
const inboxService = readFileSync(resolve(root, "src/services/inbox-service.ts"), "utf8");
const assetsApi = readFileSync(resolve(root, "src/api/assets.ts"), "utf8");
const snapshotService = readFileSync(resolve(root, "src/services/snapshot-service.ts"), "utf8");
const checkin = readFileSync(resolve(root, "src/services/checkin-bridge.ts"), "utf8");
const checkinDomain = readFileSync(resolve(root, "src/domain/checkin.ts"), "utf8");

test("外部联调矩阵覆盖四条链路和真实 blocker", () => {
    for (const id of ["INT-01", "INT-02", "INT-03", "INT-04", "INT-F01", "INT-F02", "INT-F03", "INT-F04", "INT-F05", "INT-F06", "INT-F07", "INT-F08"]) {
        assert.ok(guide.includes(`\`${id}\``), `联调文档缺少 ${id}`);
    }
    for (const blocker of ["B-0005", "B-0006", "B-0007", "B-0008"]) assert.ok(guide.includes(blocker));
    assert.match(guide, /不能关闭真实联调 blocker/);
    assert.match(guide, /成功 __ \/ 跳过 __ \/ 失败 __ \/ 可重试 __/);
});

test("导入和收集箱矩阵对应实际入口与去重/保留语义", () => {
    for (const source of [importService, importers]) {
        assert.match(source, /previewImport|parseImport/);
        assert.match(source, /normalizeUrl/);
    }
    assert.match(importService, /runImport/);
    assert.match(importService, /signal\?\.aborted/);
    assert.match(inboxApi, /getShorthands/);
    assert.match(inboxApi, /removeShorthands/);
    assert.match(inboxService, /findClipUrlConflict/);
    assert.match(inboxService, /cloudRemoved/);
    assert.match(inboxService, /captureClip/);
});

test("快照和打卡矩阵对应资产写入、能力协商与幂等入口", () => {
    assert.match(assetsApi, /exportHTML/);
    assert.match(assetsApi, /putFile/);
    assert.match(snapshotService, /snapshotAssetPath/);
    assert.match(snapshotService, /writeClip/);
    assert.match(snapshotService, /快照导出为空/);
    for (const capability of ["items.query", "events.record"]) assert.match(checkin, new RegExp(capability.replace(".", "\\.")));
    for (const marker of ["protocol", "whenReady", "hasCapability", "externalRef", "unavailable", "rejected"]) assert.match(checkin, new RegExp(marker));
    assert.match(checkinDomain, /glean:/);
    assert.match(checkinDomain, /localDate/);
});

test("联调文档明确外部失败不能破坏本地数据主权", () => {
    for (const term of ["不覆盖正文", "不创建重复", "不能阻断", "不写空快照", "保留云条目", "抛裸异常"]) {
        assert.match(guide, new RegExp(term));
    }
    assert.match(guide, /不上传导出文件全文/);
    assert.match(guide, /不上传.*私人 token/);
});
