import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VISUAL_STATES, VISUAL_VIEWPORTS, buildVisualCases } from "./visual-matrix.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(root, "docs/visual-regression/baseline.json");
const strict = process.argv.includes("--strict");

function fail(errors) {
    if (errors.length === 0) return;
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    process.exitCode = 1;
}

function readPngSize(filePath) {
    const header = fs.readFileSync(filePath);
    if (header.length < 24 || !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        throw new Error("不是 PNG 文件");
    }
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

const errors = [];
let manifest;
try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch (error) {
    errors.push(`无法读取 ${path.relative(root, manifestPath)}：${error.message}`);
    fail(errors);
    process.exit(1);
}

if (manifest.schemaVersion !== 1) errors.push("baseline.json 的 schemaVersion 必须为 1");
if (manifest.source !== "design/prototype-v2.html") errors.push("baseline.json 必须声明 design/prototype-v2.html 为设计参考");

const expectedViewports = new Map(VISUAL_VIEWPORTS.map((viewport) => [viewport.id, viewport]));
const actualViewports = new Map((manifest.viewports ?? []).map((viewport) => [viewport.id, viewport]));
if (actualViewports.size !== expectedViewports.size) errors.push("视口数量必须为 3");
for (const [id, expected] of expectedViewports) {
    const actual = actualViewports.get(id);
    if (!actual) {
        errors.push(`缺少视口 ${id}`);
        continue;
    }
    if (actual.width !== expected.width || actual.height !== expected.height) {
        errors.push(`${id} 必须为 ${expected.width}x${expected.height}`);
    }
}

const expectedStates = new Map(VISUAL_STATES.map((state) => [state.id, state]));
const actualStates = new Map((manifest.states ?? []).map((state) => [state.id, state]));
if (actualStates.size !== expectedStates.size) errors.push("状态数量必须为 8");
for (const [id, expected] of expectedStates) {
    const actual = actualStates.get(id);
    if (!actual) {
        errors.push(`缺少状态 ${id}`);
        continue;
    }
    if (actual.label !== expected.label || actual.expectation !== expected.expectation) {
        errors.push(`状态 ${id} 的说明必须与矩阵事实源一致`);
    }
}

const expectedCases = new Map(buildVisualCases().map((item) => [item.id, item]));
const actualCases = new Map((manifest.cases ?? []).map((item) => [item.id, item]));
if (actualCases.size !== expectedCases.size) errors.push("案例数量必须为 24（3 个视口 × 8 个状态）");
for (const [id, expected] of expectedCases) {
    const actual = actualCases.get(id);
    if (!actual) {
        errors.push(`缺少案例 ${id}`);
        continue;
    }
    if (actual.viewport !== expected.viewport || actual.state !== expected.state) errors.push(`${id} 的视口或状态不匹配`);
    if (actual.screenshot !== expected.screenshot || actual.recording !== expected.recording) errors.push(`${id} 的产物路径不符合命名规则`);
    if (!["pending-host", "captured"].includes(actual.status)) errors.push(`${id} 的 status 无效`);
    if (actual.status === "pending-host" && strict) errors.push(`${id} 仍等待作者真实宿主截图`);
    if (actual.status === "captured") {
        const screenshotPath = path.join(root, actual.screenshot);
        if (!fs.existsSync(screenshotPath)) {
            errors.push(`${id} 标记 captured 但截图不存在：${actual.screenshot}`);
        } else {
            try {
                const size = readPngSize(screenshotPath);
                const viewport = expectedViewports.get(actual.viewport);
                if (size.width !== viewport.width || size.height !== viewport.height) {
                    errors.push(`${id} 截图尺寸为 ${size.width}x${size.height}，应为 ${viewport.width}x${viewport.height}`);
                }
            } catch (error) {
                errors.push(`${id} 截图无法读取：${error.message}`);
            }
        }
    }
}
for (const id of actualCases.keys()) {
    if (!expectedCases.has(id)) errors.push(`存在未登记的案例 ${id}`);
}

fail(errors);
if (errors.length === 0) {
    const pending = [...actualCases.values()].filter((item) => item.status === "pending-host").length;
    const captured = [...actualCases.values()].filter((item) => item.status === "captured").length;
    console.log(`视觉矩阵通过：${actualCases.size} 个案例，${captured} 个已捕获，${pending} 个等待真实宿主。`);
}

