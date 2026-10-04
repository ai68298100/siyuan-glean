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

