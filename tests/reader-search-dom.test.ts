import test from "node:test";
import assert from "node:assert/strict";
import {
    collectVisibleTextSegments,
    isCustomHighlightSupported,
    mapOffsetsToRange,
    ReaderDOMSearchController,
    HIGHLIGHT_NAME_ALL,
    HIGHLIGHT_NAME_ACTIVE,
    type DOMSearchMatch,
} from "../src/libs/reader-search-dom.ts";

/**
 * 极简健壮的 DOM Mock 类，供纯 Node 测试环境验证控制器算法与交互
 */
class MockNode {
    nodeType: number;
    nodeValue: string | null;
    parentElement: MockElement | null = null;

    constructor(nodeType: number, nodeValue: string | null = null) {
        this.nodeType = nodeType;
        this.nodeValue = nodeValue;
    }
}

class MockText extends MockNode {
    constructor(text: string) {
        super(3, text);
    }
}

class MockElement extends MockNode {
    tagName: string;
    childNodes: MockNode[] = [];
    isConnected = true;
    attributes = new Map<string, string>();
    scrolledIntoView = false;

    constructor(tagName: string) {
        super(1);
        this.tagName = tagName.toUpperCase();
    }

    appendChild<T extends MockNode>(child: T): T {
        child.parentElement = this;
        this.childNodes.push(child);
        return child;
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    closest(selector: string): MockElement | null {
        let cur: MockElement | null = this;
        while (cur) {
            if (selector.includes("[hidden]") && cur.attributes.has("hidden")) return cur;
            if (selector.includes("[aria-hidden='true']") && cur.attributes.get("aria-hidden") === "true") return cur;
            if (selector.includes(".glean-reader__find-bar") && cur.attributes.get("class")?.includes("glean-reader__find-bar")) return cur;
            cur = cur.parentElement;
        }
        return null;
    }

    scrollIntoView(): void {
        this.scrolledIntoView = true;
    }
}

class MockRange {
    startContainer: MockNode | null = null;
    startOffset = 0;
    endContainer: MockNode | null = null;
    endOffset = 0;

    setStart(node: MockNode, offset: number) {
        this.startContainer = node;
        this.startOffset = offset;
    }

    setEnd(node: MockNode, offset: number) {
        this.endContainer = node;
        this.endOffset = offset;
    }
}

class MockTreeWalker {
    private nodes: MockNode[] = [];
    private index = 0;

    constructor(root: MockElement, filter?: { acceptNode: (n: MockNode) => number }) {
        const collect = (node: MockNode) => {
            if (node !== root && node.nodeType === 3) {
                if (filter) {
                    const decision = filter.acceptNode(node);
                    if (decision === 1) { // NodeFilter.FILTER_ACCEPT
                        this.nodes.push(node);
                    }
                } else {
                    this.nodes.push(node);
                }
            }
            if (node instanceof MockElement) {
                for (const child of node.childNodes) {
                    collect(child);
                }
            }
        };
        collect(root);
    }

    nextNode(): MockNode | null {
        if (this.index >= this.nodes.length) return null;
        return this.nodes[this.index++];
    }
}

function setupMockEnvironment() {
    const documentStub = {
        createRange() {
            return new MockRange();
        },
        createTreeWalker(root: MockElement, _whatToShow: number, filter?: { acceptNode: (n: MockNode) => number }) {
            return new MockTreeWalker(root, filter);
        },
    };

    (globalThis as unknown as { NodeFilter: Record<string, number> }).NodeFilter = {
        SHOW_TEXT: 4,
        FILTER_ACCEPT: 1,
        FILTER_REJECT: 2,
        FILTER_SKIP: 3,
    };
    (globalThis as unknown as { Text: unknown }).Text = MockText;
    (globalThis as unknown as { Range: unknown }).Range = MockRange;
    (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = MockElement;
    (globalThis as unknown as { document: unknown }).document = documentStub;
    (globalThis as unknown as { window: unknown }).window = {
        document: documentStub,
    };
}

setupMockEnvironment();

test("collectVisibleTextSegments: 正确收集有效文本节点并过滤脚本与隐藏节点", () => {
    setupMockEnvironment();

    const root = new MockElement("div");
    const p1 = root.appendChild(new MockElement("p"));
    const t1 = p1.appendChild(new MockText("Hello "));
    const strong = p1.appendChild(new MockElement("strong"));
    const t2 = strong.appendChild(new MockText("World"));

    // 脚本与隐藏元素应当被忽略
    const script = root.appendChild(new MockElement("script"));
    script.appendChild(new MockText("console.log('secret');"));

    const hiddenDiv = root.appendChild(new MockElement("div"));
    hiddenDiv.setAttribute("aria-hidden", "true");
    hiddenDiv.appendChild(new MockText("Hidden content"));

    const p2 = root.appendChild(new MockElement("p"));
    const t3 = p2.appendChild(new MockText("!"));

    const result = collectVisibleTextSegments(root as unknown as HTMLElement);
    assert.equal(result.fullText, "Hello World!");
    assert.equal(result.segments.length, 3);
    assert.equal(result.segments[0].node, t1);
    assert.equal(result.segments[0].start, 0);
    assert.equal(result.segments[0].end, 6);
    assert.equal(result.segments[1].node, t2);
    assert.equal(result.segments[1].start, 6);
    assert.equal(result.segments[1].end, 11);
    assert.equal(result.segments[2].node, t3);
    assert.equal(result.segments[2].start, 11);
    assert.equal(result.segments[2].end, 12);
});

test("mapOffsetsToRange: 支持单节点及跨节点精确定位", () => {
    setupMockEnvironment();

    const t1 = new MockText("思源");
    const t2 = new MockText("小驴");
    const t3 = new MockText("拾遗");
    const segments = [
        { node: t1 as unknown as Text, start: 0, end: 2, length: 2 },
        { node: t2 as unknown as Text, start: 2, end: 4, length: 2 },
        { node: t3 as unknown as Text, start: 4, end: 6, length: 2 },
    ];

    const doc = globalThis.document as unknown as Document;

    // 1. 单节点匹配
    const range1 = mapOffsetsToRange(doc, segments, 2, 4) as unknown as MockRange;
    assert.ok(range1);
    assert.equal(range1.startContainer, t2);
    assert.equal(range1.startOffset, 0);
    assert.equal(range1.endContainer, t2);
    assert.equal(range1.endOffset, 2);

    // 2. 跨节点匹配："源小驴拾" (start=1, end=5)
    const range2 = mapOffsetsToRange(doc, segments, 1, 5) as unknown as MockRange;
    assert.ok(range2);
    assert.equal(range2.startContainer, t1);
    assert.equal(range2.startOffset, 1);
    assert.equal(range2.endContainer, t3);
    assert.equal(range2.endOffset, 1);

    // 3. 非法范围
    assert.equal(mapOffsetsToRange(doc, segments, 5, 2), null);
    assert.equal(mapOffsetsToRange(doc, segments, 10, 12), null);
});

test("ReaderDOMSearchController: 全流程驱动匹配、上一个/下一个回绕与开关重置", () => {
    setupMockEnvironment();

    const root = new MockElement("div");
    const p = root.appendChild(new MockElement("p"));
    p.appendChild(new MockText("Siyuan Glean is great. Another glean item in Siyuan."));

    const controller = new ReaderDOMSearchController(root as unknown as HTMLElement);

    let observedState = controller.getState();
    const unsubscribe = controller.subscribe((s) => {
        observedState = s;
    });

    // 初始状态
    assert.equal(observedState.open, false);
    assert.equal(observedState.totalMatches, 0);
    assert.equal(observedState.activeIndex, -1);

    // 打开搜索并输入关键词
    controller.open("glean");
    assert.equal(observedState.open, true);
    assert.equal(observedState.keyword, "glean");
    assert.equal(observedState.totalMatches, 2);
    assert.equal(observedState.activeIndex, 0);
    assert.equal(controller.getMatches().length, 2);

    // 下一个匹配
    controller.next();
    assert.equal(observedState.activeIndex, 1);

    // 再次下一个：回绕到第一个
    controller.next();
    assert.equal(observedState.activeIndex, 0);

    // 上一个：回绕到最后一个
    controller.prev();
    assert.equal(observedState.activeIndex, 1);

    // 切换为大小写敏感
    controller.setCaseSensitive(true);
    assert.equal(observedState.caseSensitive, true);
    // 只有一个小写的 "glean" ("Glean"被排除)
    assert.equal(observedState.totalMatches, 1);
    assert.equal(observedState.activeIndex, 0);

    // 搜索不存在的内容
    controller.search("not_found");
    assert.equal(observedState.totalMatches, 0);
    assert.equal(observedState.activeIndex, -1);
    assert.equal(controller.getActiveMatch(), null);

    // 关闭搜索
    controller.close();
    assert.equal(observedState.open, false);
    assert.equal(observedState.totalMatches, 0);
    assert.equal(observedState.activeIndex, -1);

    // 销毁
    controller.dispose();
    unsubscribe();
});

test("CSS.highlights 注入与降级：支持高亮注册并在清理时安全注销", () => {
    setupMockEnvironment();

    class MockHighlight {
        ranges: MockRange[];
        constructor(...ranges: MockRange[]) {
            this.ranges = ranges;
        }
    }

    const registry = new Map<string, MockHighlight>();
    (globalThis as unknown as { CSS: unknown }).CSS = {
        highlights: {
            set: (name: string, h: MockHighlight) => registry.set(name, h),
            delete: (name: string) => registry.delete(name),
            clear: () => registry.clear(),
        },
    };
    (globalThis as unknown as { Highlight: unknown }).Highlight = MockHighlight;

    assert.equal(isCustomHighlightSupported(), true);

    const root = new MockElement("div");
    const p = root.appendChild(new MockElement("p"));
    p.appendChild(new MockText("Alpha Beta Gamma Alpha"));

    const controller = new ReaderDOMSearchController(root as unknown as HTMLElement);
    controller.open("Alpha");

    assert.equal(controller.getState().totalMatches, 2);
    assert.ok(registry.has(HIGHLIGHT_NAME_ALL));
    assert.ok(registry.has(HIGHLIGHT_NAME_ACTIVE));

    // 切换到下一个高亮
    controller.next();
    assert.equal(controller.getState().activeIndex, 1);

    // 关闭后应注销高亮
    controller.close();
    assert.ok(!registry.has(HIGHLIGHT_NAME_ALL));
    assert.ok(!registry.has(HIGHLIGHT_NAME_ACTIVE));

    // 清理全局 mock
    delete (globalThis as unknown as { CSS?: unknown }).CSS;
    delete (globalThis as unknown as { Highlight?: unknown }).Highlight;
});

