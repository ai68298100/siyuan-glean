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

test("双语 README 展示待发布摘要、系列插件和折叠历史", () => {
    const currentUpdate = readme.indexOf("## v1.3.2 更新（2026-10-10）");
    const historyStart = readme.indexOf("<details>", currentUpdate);
    const v131History = readme.indexOf("### v1.3.1（2026-10-09）", historyStart);
    const historyEnd = readme.indexOf("</details>", historyStart);
    assert.ok(currentUpdate >= 0 && currentUpdate < historyStart && historyStart < v131History && v131History < historyEnd);
    assert.match(readme.slice(0, 700), /剪藏[\s\S]*稍后读[\s\S]*阅读管理[\s\S]*收件箱[\s\S]*读库/);
    const familyStart = readme.indexOf("## 小驴系列插件", currentUpdate);
    const familySection = readme.slice(familyStart, historyStart);
    assert.ok(familyStart > currentUpdate && familyStart < historyStart);

    const family = [
        ["小驴雷切", "siyuan-speed-switch"],
        ["小驴打卡", "siyuan-checkin"],
        ["小驴人脉", "siyuan-contacts"],
        ["小驴拾遗", "siyuan-glean"],
        ["小驴考试（内测版）", "siyuan-exam"],
        ["小驴管家（内测版）", "siyuan-home"],
        ["小驴闪卡（内测版）", "siyuan-lv-cards"],
        ["小驴常用（内测版）", "xiaolv-common"],
    ] as const;
    for (const [name, repository] of family) {
        assert.ok(familySection.includes(name), `${name} should appear in the family table`);
        assert.ok(familySection.includes(`https://github.com/ai68298100/${repository}`));
        assert.ok(readmeEn.includes(`https://github.com/ai68298100/${repository}`));
    }
    assert.match(readme, /QQ 群：\*\*871707735\*\*/);
    assert.match(readme, /反馈 Bug、提交需求和交流使用体验/);

    const currentUpdateEn = readmeEn.indexOf("## v1.3.2 update (2026-10-10)");
    const historyStartEn = readmeEn.indexOf("<details>", currentUpdateEn);
    const v131HistoryEn = readmeEn.indexOf("### v1.3.1 (2026-10-09)", historyStartEn);
    const historyEndEn = readmeEn.indexOf("</details>", historyStartEn);
    assert.ok(currentUpdateEn >= 0 && currentUpdateEn < historyStartEn && historyStartEn < v131HistoryEn && v131HistoryEn < historyEndEn);
    const familyStartEn = readmeEn.indexOf("## The Lv plugin family", currentUpdateEn);
    const familySectionEn = readmeEn.slice(familyStartEn, historyStartEn);
    assert.ok(familyStartEn > currentUpdateEn && familyStartEn < historyStartEn);
    for (const [name] of family) {
        assert.ok(familySectionEn.includes(name.replace("（内测版）", "")), `${name} should appear in the English family table`);
    }
    for (const name of ["小驴考试", "小驴管家", "小驴闪卡", "小驴常用"]) {
        assert.ok(familySectionEn.includes(`${name} (Beta)`), `${name} should be marked as beta in the English family table`);
    }
    assert.match(readmeEn, /QQ group: \*\*871707735\*\*/);
});

test("设置与首启能力卡说明 AI 前置条件和失败降级", () => {
    assert.match(zh, /无模型|配置|失败|降级/);
    assert.match(en, /model|configur|fail|degrad/i);
    assert.match(zh, /AI 摘要与标签.*配置|AI 摘要.*需/);
    assert.match(en, /AI summaries.*configur|AI summaries.*require/i);
    assert.match(zh, /默认仅手动/);
    assert.match(en, /manual-only by default/);
});
