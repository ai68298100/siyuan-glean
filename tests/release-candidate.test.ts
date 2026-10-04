import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { name: string; version: string };
const manifest = JSON.parse(readFileSync(resolve(root, "plugin.json"), "utf8")) as { name: string; version: string };
const changelog = readFileSync(resolve(root, "docs/CHANGELOG.md"), "utf8");
const release = readFileSync(resolve(root, "docs/RELEASE.md"), "utf8");
const media = readFileSync(resolve(root, "docs/RELEASE-MEDIA.md"), "utf8");
const candidate = readFileSync(resolve(root, "docs/RELEASE-CANDIDATE.md"), "utf8");
const capability = readFileSync(resolve(root, "docs/CAPABILITY-MATRIX.md"), "utf8");

test("发布候选版本、变更记录和构建门禁口径一致", () => {
    assert.equal(pkg.name, manifest.name);
    assert.equal(pkg.version, manifest.version);
    assert.match(changelog, new RegExp(`## v${pkg.version.replace(".", "\\.")}`));
    for (const command of ["pnpm check", "pnpm test", "pnpm build"]) {
        assert.ok(release.includes(command), `发布手册缺少 ${command}`);
        assert.ok(candidate.includes(command), `候选清单缺少 ${command}`);
    }
    assert.ok(candidate.includes("pnpm check:release"));
    assert.ok(media.includes("pnpm check:release"));
});

test("发布材料不保留旧版本命令，也保留真实授权边界", () => {
    assert.doesNotMatch(media, /pnpm update-version.*v1\.0\.0/);
    assert.match(media, /package\.json|plugin\.json/);
    assert.match(release, /需作者确认/);
    assert.match(release, /需作者单独授权/);
    assert.match(candidate, /不执行这些外部动作/);
    assert.match(candidate, /真实宿主/);
});

test("发布候选继续引用能力矩阵的保守对外口径", () => {
    assert.match(candidate, /能力矩阵/);
    assert.match(candidate, /默认手动/);
    assert.match(candidate, /不写“全平台已验证”/);
    assert.match(capability, /真实状态/);
    assert.match(capability, /B-0004/);
    assert.match(capability, /B-0005/);
    assert.match(capability, /B-0006/);
    assert.match(capability, /B-0007/);
    assert.match(capability, /B-0008/);
});
