import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

test("读库治理提示位于三种布局分支之外且每组只渲染一次", () => {
    const source = read("src/ui/DockPanel.svelte");
    const layoutBranch = source.indexOf("{#if loading && !index.updatedAt}");
    const cueStart = source.indexOf("{#if overQuota && activeQueue === \"inbox\" && !authorTimeline && !governanceCueMuted");

    assert.ok(cueStart >= 0);
    assert.ok(layoutBranch > cueStart);
    assert.equal(source.match(/panel\.quotaOver/g)?.length, 1);
    assert.equal(source.match(/panel\.staleCandidates/g)?.length, 1);
    assert.equal(source.match(/panel\.candidatesDetected/g)?.length, 1);
    assert.equal(source.match(/class=\"glean-candidates\"/g)?.length, 1);
    assert.match(source, /stalePreviewOpen/);
    assert.match(source, /selection\.has\(entry\.id\)/);
});

test("治理动作复用显式归档 ID，并保留属性主权边界", () => {
    const source = read("src/ui/DockPanel.svelte");

    assert.match(source, /const ids = stalePool\.filter\(\(entry\) => staleSelected\.has\(entry\.id\)\)\.map\(\(entry\) => entry\.id\)/);
    assert.match(source, /archiveStaleCandidates\(facade\.pluginInstance, ids\)/);
    assert.doesNotMatch(source, /\b(?:setBlockAttrs|batchSetBlockAttrs)\b/);
});

test("多条治理提醒默认收纳为会话内摘要，展开不写持久状态", () => {
    const source = read("src/ui/DockPanel.svelte");
    assert.match(source, /governanceCueCount/);
    assert.match(source, /governanceExpanded = \$state\(false\)/);
    assert.match(source, /panel\.governanceSummary/);
    assert.match(source, /panel\.governanceExpand/);
    assert.match(source, /panel\.governanceCollapse/);
    assert.match(source, /aria-expanded=\{governanceExpanded\}/);
    assert.match(source, /governanceDetailsVisible/);
    assert.match(source, /governanceExpanded = \$state\(false\)/);
});

test("候选治理提示提供统一入口并切到待分拣列表", () => {
    const source = read("src/ui/DockPanel.svelte");
    assert.match(source, /function openCandidateQueue\(\): void/);
    assert.match(source, /view = "library"/);
    assert.match(source, /activeQueue = "inbox"/);
    assert.match(source, /if \(isTabCanvas\) layoutMode = "list"/);
    assert.match(source, /panel\.viewCandidates/);
    assert.match(source, /onclick={openCandidateQueue}/);
});

test("治理提示支持按日分别静默，静默动作复用 UI 偏好存储", () => {
    const source = read("src/ui/DockPanel.svelte");
    assert.match(source, /function muteGovernanceCue\(key: GovernanceCueKey\)/);
    assert.match(source, /governanceCueMuted\("quota", governanceMuted\)/);
    assert.match(source, /governanceCueMuted\("stale", governanceMuted\)/);
    assert.match(source, /governanceCueMuted\("candidates", governanceMuted\)/);
    assert.equal(source.match(/panel\.governanceMuteToday/g)?.length, 3);
    assert.match(source, /saveUiPrefs\(facade\.pluginInstance, \{ governanceMuted: next \}\)/);
    assert.match(source, /const saved = await saveUiPrefs\(facade\.pluginInstance, \{ governanceMuted: next \}\)/);
    assert.match(source, /governanceMuted = saved\.governanceMuted/);
    assert.doesNotMatch(source, /custom-clip-governance/);
});
