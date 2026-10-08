import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const matrix = readFileSync(resolve(root, "docs/CAPABILITY-MATRIX.md"), "utf8");
const readme = readFileSync(resolve(root, "README.md"), "utf8");
const readmeEn = readFileSync(resolve(root, "README.en-US.md"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(root, "plugin.json"), "utf8"));
const zh = readFileSync(resolve(root, "public/i18n/zh_CN.json"), "utf8");
const en = readFileSync(resolve(root, "public/i18n/en_US.json"), "utf8");

const capabilityIds = [
    "core-library",
    "core-resurface",
    "reader-tab",
    "ai",
    "inbox",
    "external-import",
    "snapshot",
    "checkin",
    "quote-card",
    "board",
    "official-clip",
    "mobile-browser",
    "formatting",
    "library-highlights",
    "reading-review",
    "external-bridge",
] as const;

test("能力矩阵覆盖所有对外能力并保留验证状态", () => {
    for (const id of capabilityIds) {
        const row = matrix.split("\n").find((line) => line.startsWith(`| \`${id}\` |`));
        assert.ok(row, `能力矩阵缺少 ${id}`);
        assert.match(row, /已完成/);
        assert.match(row, /隔离|回归|spike|T-3202/);
        assert.match(row, /B-000/);
        assert.match(row, /失败|降级/);
    }
});

test("能力矩阵覆盖外部验收阻塞并定义降级边界", () => {
    for (const blocker of ["B-0001", "B-0002", "B-0004", "B-0005", "B-0006", "B-0007", "B-0008", "B-0009", "B-0010"]) {
        assert.match(matrix, new RegExp(blocker.replace("-", "\\-")));
    }
    assert.match(matrix, /不承诺 AV 编辑反向同步属性/);
    assert.match(matrix, /不写“自动同步”/);
    assert.match(matrix, /不阻断“已读”/);
});

test("README 和集市描述引用同一能力边界", () => {
    assert.match(readme, /docs\/CAPABILITY-MATRIX\.md/);
    assert.match(readmeEn, /docs\/CAPABILITY-MATRIX\.md/);
    assert.match(readme, /真实验收|真实宿主|阻塞/);
    assert.match(readmeEn, /real(?:-environment)? acceptance|blocker/i);
    assert.match(manifest.description["zh-CN"], /可选|手动|配置/);
    assert.match(manifest.description.default, /optional|manual|configured/i);
    assert.doesNotMatch(manifest.description["zh-CN"], /自动摘要|自动打标/);
    assert.doesNotMatch(manifest.description.default, /automatic AI|AI summaries on every capture/i);
});

test("设置与首启能力卡说明 AI 前置条件和失败降级", () => {
    assert.match(zh, /无模型|配置|失败|降级/);
    assert.match(en, /model|configur|fail|degrad/i);
    assert.match(zh, /AI 摘要与标签.*配置|AI 摘要.*需/);
    assert.match(en, /AI summaries.*configur|AI summaries.*require/i);
    assert.match(zh, /默认仅手动/);
    assert.match(en, /manual-only by default/);
});
