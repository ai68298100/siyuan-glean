import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { main, SESSION_KINDS, validateSessionRecord } from "../scripts/e2e/acceptance-session.mjs";
import { isSupportedE2EManifest, resolvePluginBundle } from "../scripts/e2e/plugin-identity.mjs";

const pluginVersion = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../plugin.json"), "utf8")).version;

async function quietMain(args) {
    const log = console.log;
    const error = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
        await main(args);
    } finally {
        console.log = log;
        console.error = error;
    }
}

test("acceptance sessions distinguish real device kinds from service E2E", async () => {
    assert.equal(SESSION_KINDS["android-device"].realDevice, true);
    assert.equal(SESSION_KINDS["isolated-kernel"].evidenceClass, "service-e2e");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "glean-acceptance-test-"));
    const evidence = path.join(root, "device.png");
    fs.writeFileSync(evidence, "test evidence\n");
    await quietMain(["create", "--kind", "android-device", "--name", "phone", "--device", "Pixel-test", "--root", root]);
    const sessionFile = fs.readdirSync(root).find((item) => item.endsWith(".json"));
    assert.ok(sessionFile);
    const sessionPath = path.join(root, sessionFile);
    await quietMain([
        "record",
        "--session",
        sessionPath,
        "--status",
        "running",
        "--case",
        "ANDROID-01",
        "--result",
        "passed",
        "--evidence",
        evidence,
        "--real-device-confirmed",
        "true",
    ]);
    await quietMain(["close", "--session", sessionPath, "--status", "passed"]);
    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    assert.equal(session.status, "passed");
    assert.equal(session.realDeviceConfirmed, true);
    assert.equal(session.evidence[0], path.resolve(evidence));
    assert.equal(validateSessionRecord(session), true);
    fs.rmSync(root, { recursive: true, force: true });
});

test("linking an E2E manifest records service evidence", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "glean-acceptance-link-test-"));
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    const manifestPath = path.join(root, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
        version: 1,
        createdBy: "siyuan-glean-e2e-session",
        status: "ready",
        workspace,
        host: "127.0.0.1",
        port: 41234,
        kernelVersion: "3.8.6",
        ownerPid: 1,
        kernelPid: 1,
        notebookId: "20261005000000-test001",
    }));
    await quietMain(["create", "--kind", "isolated-kernel", "--name", "linked", "--root", root]);
    const sessionFile = fs.readdirSync(root).find((item) => item.endsWith(".json") && item !== "manifest.json");
    assert.ok(sessionFile);
    const sessionPath = path.join(root, sessionFile);
    await quietMain(["link", "--session", sessionPath, "--manifest", manifestPath]);
    await assert.rejects(
        quietMain(["close", "--session", sessionPath, "--status", "passed"]),
        /逐项验收结果/,
    );
    const reportPath = path.join(root, "results.json");
    fs.writeFileSync(reportPath, JSON.stringify({
        workspace,
        host: "127.0.0.1",
        port: 41234,
        pluginVersion,
        kernelVersion: "3.8.6",
        results: [{ name: "E2E-01", ok: true }],
    }));
    await quietMain(["report", "--session", sessionPath, "--report", reportPath]);
    await assert.rejects(
        quietMain(["report", "--session", sessionPath, "--report", reportPath]),
        /已存在/,
    );
    await quietMain(["close", "--session", sessionPath, "--status", "passed"]);
    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    assert.equal(session.status, "passed");
    assert.deepEqual(session.evidence, [manifestPath, path.resolve(reportPath)]);
    assert.equal(session.checks[0].id, "E2E-01");
    assert.equal(session.evidenceClass, "service-e2e");
    fs.rmSync(root, { recursive: true, force: true });
});

test("cross-plugin bundle identity is derived from plugin.json and dist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "glean-plugin-bundle-test-"));
    fs.mkdirSync(path.join(root, "dist"), { recursive: true });
    fs.writeFileSync(path.join(root, "plugin.json"), JSON.stringify({ name: "other-plugin", version: "2.4.0" }));
    fs.writeFileSync(path.join(root, "dist", "plugin.json"), JSON.stringify({ name: "other-plugin", version: "2.4.0" }));
    fs.writeFileSync(path.join(root, "dist", "index.js"), "export default {};\n");
    const bundle = resolvePluginBundle(root);
    assert.equal(bundle.name, "other-plugin");
    assert.equal(bundle.version, "2.4.0");
    assert.equal(bundle.distDir, path.join(root, "dist"));
    assert.equal(isSupportedE2EManifest({ version: 1, createdBy: "siyuan-plugin-e2e-session" }), true);
    assert.equal(isSupportedE2EManifest({ version: 1, createdBy: "siyuan-glean-e2e-session" }), true);
    fs.rmSync(root, { recursive: true, force: true });
});
