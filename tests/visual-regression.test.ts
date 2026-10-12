import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildVisualCases, VISUAL_STATES, VISUAL_VIEWPORTS, visualCaseId } from "../scripts/visual/visual-matrix.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "docs/visual-regression/baseline.json"), "utf8"));

test("视觉矩阵保留三种规定视口", () => {
    assert.deepEqual(manifest.viewports.map((viewport: { id: string; width: number; height: number }) => `${viewport.id}:${viewport.width}x${viewport.height}`), [
        "desktop:1280x800",
        "narrow:768x1024",
        "mobile:390x844",
    ]);
});

test("视觉矩阵覆盖八类状态", () => {
    assert.deepEqual(manifest.states.map((state: { id: string }) => state.id), VISUAL_STATES.map((state) => state.id));
    assert.deepEqual(manifest.states.map((state: { label: string }) => state.label), VISUAL_STATES.map((state) => state.label));
});

test("视觉矩阵恰好覆盖 3×8 个唯一案例", () => {
    const expected = buildVisualCases();
    assert.equal(expected.length, 24);
    assert.equal(manifest.cases.length, expected.length);
    assert.deepEqual(manifest.cases.map((item: { id: string }) => item.id), expected.map((item) => item.id));
    assert.equal(new Set(manifest.cases.map((item: { id: string }) => item.id)).size, 24);
    for (const viewport of VISUAL_VIEWPORTS) {
        for (const state of VISUAL_STATES) {
            assert.equal(manifest.cases.some((item: { id: string }) => item.id === visualCaseId(viewport.id, state.id)), true);
        }
    }
});

test("视觉案例未取得真实宿主截图时明确保持待验收", () => {
    assert.equal(manifest.cases.every((item: { status: string }) => item.status === "pending-host"), true);
    assert.equal(manifest.source, "design/prototype-v2.html");
});

test("视觉回归协议声明真实宿主边界和严格检查命令", () => {
    const guide = readFileSync(resolve(root, "docs/visual-regression/README.md"), "utf8");
    assert.match(guide, /pnpm visual:check/);
    assert.match(guide, /--strict/);
    assert.match(guide, /pending-host/);
    assert.match(guide, /B-0009/);
    assert.match(guide, /不能冒充实际 Svelte 组件截图/);
});

test("canonical 原型覆盖同宿主专注阅读及批注回退边界", () => {
    const prototype = readFileSync(resolve(root, "design/prototype-v2.html"), "utf8");
    assert.match(prototype, /data-page="reader"/);
    assert.match(prototype, /data-action="reader-focus"/);
    assert.match(prototype, /data-action="reader-exit"/);
    assert.match(prototype, /data-action="reader-native"/);
    assert.match(prototype, /data-reader-selection/);
    assert.match(prototype, /不启用浏览器全屏/);
    assert.match(prototype, /需在真实思源中验证/);
    assert.match(prototype, /reader-screen\[data-focus="true"\]/);
});

test("canonical 原型覆盖用户标签显示别名与原值筛选", () => {
    const prototype = readFileSync(resolve(root, "design/prototype-v2.html"), "utf8");
    assert.match(prototype, /data-alias-source|id="alias-source-tag"/);
    assert.match(prototype, /data-action="alias-save"/);
    assert.match(prototype, /data-action="alias-edit"/);
    assert.match(prototype, /data-action="alias-remove"/);
    assert.match(prototype, /data-action="alias-delete-confirm"/);
    assert.match(prototype, /data-action="alias-delete-cancel"/);
    assert.match(prototype, /id="library-tag-filter"/);
    assert.match(prototype, /筛选 chip 与保存视图仍使用原标签值/);
    assert.match(prototype, /不會创建或改写文章标签|不会创建或改写文章标签/);
});

test("历史增量稿中的交互动作均已迁入 canonical 原型", () => {
    const prototype = readFileSync(resolve(root, "design/prototype-v2.html"), "utf8");
    const additions = readFileSync(resolve(root, "design/prototype-v2-additions.html"), "utf8");
    const historicalActions = [...additions.matchAll(/data-action="([a-z-]+)"/g)].map((match) => match[1]);
    const uniqueActions = [...new Set(historicalActions)];
    for (const action of uniqueActions) {
        assert.match(prototype, new RegExp(`data-action="${action}"`), `missing migrated action: ${action}`);
    }
    assert.match(additions, /历史参考/);
    assert.match(additions, /canonical 主原型/);
});

