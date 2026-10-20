import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    normalizeRailGroups,
    applyRailGroupToggle,
    syncAccordionRailGroups,
    toggleAllRailGroups,
    type RailGroups,
} from "../src/domain/library-rail.ts";

const dockPanel = readFileSync(new URL("../src/ui/DockPanel.svelte", import.meta.url), "utf8");
const railGroup = readFileSync(new URL("../src/ui/LibraryRailGroup.svelte", import.meta.url), "utf8");

test("分面偏好归一化：缺省或部分缺漏时填补全部 5 个分面默认值", () => {
    const empty = normalizeRailGroups(undefined);
    assert.deepEqual(empty, {
        queues: { collapsed: false, expanded: false },
        authors: { collapsed: false, expanded: false },
        sites: { collapsed: false, expanded: false },
        tags: { collapsed: false, expanded: false },
        aiTags: { collapsed: false, expanded: false },
    });

    const partial = normalizeRailGroups({
        queues: { collapsed: true, expanded: false },
    });
    assert.equal(partial.queues.collapsed, true);
    assert.equal(partial.authors.collapsed, false);
    assert.equal(partial.sites.collapsed, false);
    assert.equal(partial.tags.collapsed, false);
    assert.equal(partial.aiTags.collapsed, false);
});

test("非手风琴模式下：分面折叠相互独立，不影响其他分面", () => {
    const initial = normalizeRailGroups(undefined);
    const step1 = applyRailGroupToggle(initial, "queues", false);
    assert.equal(step1.queues.collapsed, true);
    assert.equal(step1.authors.collapsed, false);

    const step2 = applyRailGroupToggle(step1, "authors", false);
    assert.equal(step2.queues.collapsed, true);
    assert.equal(step2.authors.collapsed, true);

    const step3 = applyRailGroupToggle(step2, "queues", false);
    assert.equal(step3.queues.collapsed, false);
    assert.equal(step3.authors.collapsed, true);
});

test("手风琴模式下：展开某分面时自动折叠其他所有分面（互斥）", () => {
    const initial: RailGroups = {
        queues: { collapsed: true, expanded: false },
        authors: { collapsed: false, expanded: false },
        sites: { collapsed: true, expanded: false },
        tags: { collapsed: true, expanded: false },
        aiTags: { collapsed: true, expanded: false },
    };

    // 展开 queues，原本展开的 authors 应该自动折叠
    const next = applyRailGroupToggle(initial, "queues", true);
    assert.equal(next.queues.collapsed, false);
    assert.equal(next.authors.collapsed, true);
    assert.equal(next.sites.collapsed, true);
    assert.equal(next.tags.collapsed, true);
    assert.equal(next.aiTags.collapsed, true);

    // 折叠当前已展开的 queues，正常折叠，其他保持折叠
    const folded = applyRailGroupToggle(next, "queues", true);
    assert.equal(folded.queues.collapsed, true);
    assert.equal(folded.authors.collapsed, true);
});

test("开启手风琴模式同步：若多个分面均展开，仅保留首个展开分面", () => {
    const multiOpen: RailGroups = {
        queues: { collapsed: false, expanded: false },
        authors: { collapsed: false, expanded: false },
        sites: { collapsed: false, expanded: false },
        tags: { collapsed: true, expanded: false },
        aiTags: { collapsed: true, expanded: false },
    };

    const synced = syncAccordionRailGroups(multiOpen);
    assert.equal(synced.queues.collapsed, false);
    assert.equal(synced.authors.collapsed, true);
    assert.equal(synced.sites.collapsed, true);
    assert.equal(synced.tags.collapsed, true);
    assert.equal(synced.aiTags.collapsed, true);

    // 全部折叠时保持全部折叠
    const allFolded = toggleAllRailGroups(multiOpen, true);
    const syncedFolded = syncAccordionRailGroups(allFolded);
    assert.deepEqual(syncedFolded, allFolded);
});

test("全部折叠与全部展开：批量更新所有 5 个分面", () => {
    const initial = normalizeRailGroups(undefined);
    const collapsed = toggleAllRailGroups(initial, true);
    assert.equal(collapsed.queues.collapsed, true);
    assert.equal(collapsed.authors.collapsed, true);
    assert.equal(collapsed.sites.collapsed, true);
    assert.equal(collapsed.tags.collapsed, true);
    assert.equal(collapsed.aiTags.collapsed, true);

    const expanded = toggleAllRailGroups(collapsed, false);
    assert.equal(expanded.queues.collapsed, false);
    assert.equal(expanded.authors.collapsed, false);
    assert.equal(expanded.sites.collapsed, false);
    assert.equal(expanded.tags.collapsed, false);
    assert.equal(expanded.aiTags.collapsed, false);
});

test("UI 模板接线断言：DockPanel.svelte 与 LibraryRailGroup.svelte 完整支持手风琴与工具条", () => {
    // 侧栏顶部工具条与无障碍角色
    assert.match(dockPanel, /class="glean-rail__toolbar"/);
    assert.match(dockPanel, /role="toolbar"/);
    assert.match(dockPanel, /aria-label=\{t\(i18n, "rail\.title"\)\}/);

    // 手风琴开关与图标
    assert.match(dockPanel, /onclick=\{toggleAccordion\}/);
    assert.match(dockPanel, /href="#iconGleanAccordion"/);
    assert.match(dockPanel, /href="#iconGleanCollapseAll"/);
    assert.match(dockPanel, /href="#iconGleanExpandAll"/);

    // LibraryRailGroup 受控模式
    assert.match(dockPanel, /groupPrefs=\{railGroups\.queues\}/);
    assert.match(dockPanel, /onToggleGroup=\{handleToggleRailGroup\}/);

    // LibraryRailGroup 内部支持外部 groupPrefs 衍生
    assert.match(railGroup, /groupPrefs\?: RailGroupPrefs/);
    assert.match(railGroup, /onToggleGroup\?: \(group: RailGroupKey, key: keyof RailGroupPrefs\) => void/);
    assert.match(railGroup, /const prefs = \$derived\(groupPrefs \?\? localPrefs\)/);
});
