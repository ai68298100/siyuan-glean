import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "glean-excerpt:siyuan", shortCircuit: true };
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-excerpt:siyuan") {
            return {
                format: "module",
                source: "export const fetchSyncPost = (...args) => globalThis.__gleanExcerptPost(...args);",
                shortCircuit: true,
            };
        }
        return nextLoad(url, context);
    },
});

const { excerptFromSelection, insertQuoteExcerpt, selectionBelongsToHost } = await import("../src/services/excerpt-service.ts");

const validBlockId = "20261004120000-aaaaaaa";

function element(parent = null, attributes = {}) {
    const node = {
        nodeType: 1,
        parentElement: parent,
        children: [],
        contains(candidate) {
            return candidate === node || node.children.some((child) => child.contains(candidate));
        },
        closest(selector) {
            if (selector !== "[data-node-id]") return null;
            let current = node;
            while (current) {
                if (Object.hasOwn(current.attributes, "data-node-id")) return current;
                current = current.parentElement;
            }
            return null;
        },
        getAttribute(name) {
            return node.attributes[name] ?? null;
        },
        attributes,
    };
    if (parent) parent.children.push(node);
    return node;
}

function textNode(parent) {
    const node = { nodeType: 3, parentElement: parent, contains(candidate) { return candidate === node; } };
    parent.children.push(node);
    return node;
}

function range(startContainer, endContainer) {
    return { startContainer, endContainer };
}

function selection({ anchorNode, focusNode, ranges, text = "选中的文字", collapsed = false, getRangeAt, stringify } = {}) {
    let textReads = 0;
    return {
        isCollapsed: collapsed,
        anchorNode,
        focusNode,
        rangeCount: ranges?.length ?? 0,
        getRangeAt(index) {
            if (getRangeAt) return getRangeAt(index);
            return ranges[index];
        },
        toString() {
            textReads += 1;
            if (stringify) return stringify();
            return text;
        },
        get textReads() {
            return textReads;
        },
    };
}

function bodyFixture(firstAttributes = { "data-node-id": validBlockId }, secondAttributes = { "data-node-id": "20261004120001-bbbbbbb" }) {
    const host = element();
    const firstBlock = element(host, firstAttributes);
    const secondBlock = element(host, secondAttributes);
    return {
        host,
        firstText: textNode(firstBlock),
        secondText: textNode(secondBlock),
        outside: textNode(element()),
    };
}

test("接受正文内反向跨块选区，并保留 Unicode 与 4000 字上限", () => {
    const fixture = bodyFixture();
    const picked = selection({
        anchorNode: fixture.secondText,
        focusNode: fixture.firstText,
        ranges: [range(fixture.firstText, fixture.secondText)],
        text: `  中文🙂\n 世界  ${"a".repeat(4005)}`,
    });

    const result = excerptFromSelection(fixture.host, picked);

    assert.equal(result.blockId, "20261004120001-bbbbbbb");
    assert.equal(result.text, "中文🙂 世界 " + "a".repeat(3992));
    assert.equal(picked.textReads, 1);
});

test("selectionchange 宿主门禁只检查 anchor/focus，不读取 range 或文本", () => {
    const fixture = bodyFixture();
    const inside = selection({ anchorNode: fixture.firstText, focusNode: fixture.secondText, ranges: [range(fixture.firstText, fixture.secondText)] });
    const outside = selection({ anchorNode: fixture.outside, focusNode: fixture.firstText, ranges: [range(fixture.outside, fixture.firstText)] });
    assert.equal(selectionBelongsToHost(fixture.host, inside), true);
    assert.equal(selectionBelongsToHost(fixture.host, outside), false);
    assert.equal(selectionBelongsToHost(fixture.host, selection({ anchorNode: fixture.firstText, focusNode: fixture.secondText, ranges: [], collapsed: true })), false);
    assert.equal(selectionBelongsToHost(fixture.host, selection({ anchorNode: null, focusNode: fixture.secondText, ranges: [] })), false);
    assert.equal(inside.textReads, 0);
    assert.equal(outside.textReads, 0);
});

test("拒绝 anchor/focus 越界、任一 Range 越界、缺失 Range 或读取异常，且不读取文本", () => {
    const fixture = bodyFixture();
    const cases = [
        selection({ anchorNode: fixture.outside, focusNode: fixture.firstText, ranges: [range(fixture.outside, fixture.firstText)] }),
        selection({ anchorNode: fixture.firstText, focusNode: fixture.outside, ranges: [range(fixture.firstText, fixture.outside)] }),
        selection({ anchorNode: fixture.firstText, focusNode: fixture.secondText, ranges: [range(fixture.firstText, fixture.secondText), range(fixture.secondText, fixture.outside)] }),
        selection({ anchorNode: fixture.firstText, focusNode: fixture.secondText, ranges: [undefined] }),
        selection({ anchorNode: fixture.firstText, focusNode: fixture.secondText, ranges: [range(fixture.firstText, fixture.secondText)], getRangeAt() { throw new Error("range read failed"); } }),
    ];

    for (const candidate of cases) {
        assert.equal(excerptFromSelection(fixture.host, candidate), null);
        assert.equal(candidate.textReads, 0);
    }
});

test("Selection.toString 抛错时优雅返回 null", () => {
    const fixture = bodyFixture();
    const picked = selection({
        anchorNode: fixture.firstText,
        focusNode: fixture.secondText,
        ranges: [range(fixture.firstText, fixture.secondText)],
        stringify() { throw new Error("selection read failed"); },
    });

    assert.equal(excerptFromSelection(fixture.host, picked), null);
    assert.equal(picked.textReads, 1);
});

test("空范围、折叠或空文本没有摘录", () => {
    const fixture = bodyFixture();
    const validRange = [range(fixture.firstText, fixture.firstText)];

    assert.equal(excerptFromSelection(fixture.host, selection({ anchorNode: fixture.firstText, focusNode: fixture.firstText, ranges: [] })), null);
    assert.equal(excerptFromSelection(fixture.host, selection({ anchorNode: fixture.firstText, focusNode: fixture.firstText, ranges: validRange, collapsed: true })), null);
    assert.equal(excerptFromSelection(fixture.host, selection({ anchorNode: fixture.firstText, focusNode: fixture.firstText, ranges: validRange, text: " \n\t " })), null);
});

test("缺失或非法块 ID 降级为空定位，但仍返回正文文本", () => {
    for (const attributes of [{}, { "data-node-id": "not-a-block" }]) {
        const fixture = bodyFixture(attributes);
        const picked = selection({ anchorNode: fixture.firstText, focusNode: fixture.firstText, ranges: [range(fixture.firstText, fixture.firstText)] });

        assert.deepEqual(excerptFromSelection(fixture.host, picked), { text: "选中的文字", blockId: "" });
    }
});

test("插入摘录先校验目标块 ID，合法 ID 才调用内核", async () => {
    const calls = [];
    globalThis.__gleanExcerptPost = async (route, body) => {
        calls.push({ route, body });
        return { code: 0, data: [{ doOperations: [{ id: "20261004120002-ccccccc" }] }] };
    };

    await assert.rejects(insertQuoteExcerpt("bad-id", "文字"), /ID 无效/);
    assert.equal(calls.length, 0);
    assert.equal(await insertQuoteExcerpt(validBlockId, "文字"), "20261004120002-ccccccc");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].route, "/api/block/insertBlock");
    assert.equal(calls[0].body.previousID, validBlockId);
});
