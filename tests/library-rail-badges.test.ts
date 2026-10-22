import test from "node:test";
import assert from "node:assert/strict";
import { reconcileRailFacets, createRailBadgeDebouncer } from "../src/domain/library-rail-badges.ts";
import type { LibraryFacets } from "../src/domain/library-view.ts";

function createMockFacets(overrides: Partial<LibraryFacets> = {}): LibraryFacets {
    return {
        sites: [{ value: "example.com", count: 5 }],
        authors: [{ value: "Alice", count: 3 }],
        tags: [{ value: "tech", count: 4 }],
        aiTags: [{ value: "AI", count: 2 }],
        sources: [{ value: "web", count: 5 }],
        timeSources: [{ value: "article", count: 5 }],
        contentTypes: [{ value: "rich-article", count: 5 }],
        ...overrides,
    };
}

test("reconcileRailFacets: returns next as-is when prev is undefined", () => {
    const next = createMockFacets();
    const res = reconcileRailFacets(undefined, next);
    assert.equal(res.snapshot, next);
    assert.equal(res.changedGroups.length, 7);
});

test("reconcileRailFacets: preserves object references for unchanged groups (structural sharing)", () => {
    const prev = createMockFacets();
    const next = createMockFacets({
        authors: [{ value: "Alice", count: 3 }, { value: "Bob", count: 1 }],
    });

    const res = reconcileRailFacets(prev, next);
    assert.deepEqual(res.changedGroups, ["authors"]);
    assert.equal(res.snapshot.sites, prev.sites);
    assert.equal(res.snapshot.tags, prev.tags);
    assert.equal(res.snapshot.aiTags, prev.aiTags);
    assert.equal(res.snapshot.sources, prev.sources);
    assert.equal(res.snapshot.timeSources, prev.timeSources);
    assert.equal(res.snapshot.contentTypes, prev.contentTypes);
    assert.equal(res.snapshot.authors, next.authors);
});

test("reconcileRailFacets: returns prev snapshot directly if no groups changed", () => {
    const prev = createMockFacets();
    const next = createMockFacets();
    const res = reconcileRailFacets(prev, next);
    assert.equal(res.snapshot, prev);
    assert.deepEqual(res.changedGroups, []);
});

test("createRailBadgeDebouncer: debounces rapid calls and emits latest value", async () => {
    const flushed: number[] = [];
    const debouncer = createRailBadgeDebouncer<number>({
        delayMs: 20,
        onFlush: (v) => flushed.push(v),
    });

    debouncer.schedule(1);
    debouncer.schedule(2);
    debouncer.schedule(3);

    assert.equal(debouncer.isPending(), true);
    assert.deepEqual(flushed, []);

    await new Promise((resolve) => setTimeout(resolve, 35));

    assert.deepEqual(flushed, [3]);
    assert.equal(debouncer.isPending(), false);
});

test("createRailBadgeDebouncer: flush() immediately dispatches pending value", async () => {
    const flushed: number[] = [];
    const debouncer = createRailBadgeDebouncer<number>({
        delayMs: 50,
        onFlush: (v) => flushed.push(v),
    });

    debouncer.schedule(42);
    assert.equal(debouncer.isPending(), true);
    debouncer.flush();

    assert.deepEqual(flushed, [42]);
    assert.equal(debouncer.isPending(), false);

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(flushed, [42]);
});

test("createRailBadgeDebouncer: cancel() clears pending schedule without calling onFlush", async () => {
    const flushed: number[] = [];
    const debouncer = createRailBadgeDebouncer<number>({
        delayMs: 30,
        onFlush: (v) => flushed.push(v),
    });

    debouncer.schedule(100);
    debouncer.cancel();
    assert.equal(debouncer.isPending(), false);

    await new Promise((resolve) => setTimeout(resolve, 45));
    assert.deepEqual(flushed, []);
});
