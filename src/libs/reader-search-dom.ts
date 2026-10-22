/**
 * ReaderTab 正文 DOM 查找控制器
 *
 * 核心特性：
 * 1. 非侵入式：采用 CSS Custom Highlight API (CSS.highlights) 高亮匹配，绝不修改 Protyle 编辑器 DOM 树，杜绝内容破坏；
 * 2. 跨节点范围映射：先遍历收集文本节点建立累加文本偏移，再精准映射回原生 Range；
 * 3. 边界健壮性：在无 CSS.highlights 环境（如 Node 单元测试环境）中平稳降级；
 * 4. 视口居中导航：切换匹配时智能平滑滚动至视口可见区域。
 */
import {
    calculateMatchIndex,
    findTextOffsets,
    initialReaderSearchState,
    normalizeSearchKeyword,
    type ReaderSearchState,
} from "../domain/reader-search.ts";

export interface DOMSearchMatch {
    index: number;
    range: Range;
    startNode: Text;
    startOffset: number;
    endNode: Text;
    endOffset: number;
}

interface TextSegment {
    node: Text;
    start: number;
    end: number;
    length: number;
}

export const HIGHLIGHT_NAME_ALL = "glean-search-all";
export const HIGHLIGHT_NAME_ACTIVE = "glean-search-active";

function getCSSHighlightsRegistry(): Map<string, unknown> | null {
    try {
        if (typeof CSS !== "undefined" && (CSS as unknown as { highlights?: Map<string, unknown> }).highlights) {
            return (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
        }
        if (typeof window !== "undefined" && (window as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights) {
            return (window as unknown as { CSS: { highlights: Map<string, unknown> } }).CSS.highlights;
        }
        if (typeof globalThis !== "undefined" && (globalThis as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights) {
            return (globalThis as unknown as { CSS: { highlights: Map<string, unknown> } }).CSS.highlights;
        }
    } catch {
        // ignore
    }
    return null;
}

function getHighlightConstructor(): (new (...ranges: Range[]) => unknown) | null {
    try {
        if (typeof Highlight !== "undefined") {
            return Highlight;
        }
        if (typeof window !== "undefined" && (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight) {
            return (window as unknown as { Highlight: new (...ranges: Range[]) => unknown }).Highlight;
        }
        if (typeof globalThis !== "undefined" && (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight) {
            return (globalThis as unknown as { Highlight: new (...ranges: Range[]) => unknown }).Highlight;
        }
    } catch {
        // ignore
    }
    return null;
}

/**
 * 判断当前执行环境是否支持 CSS Custom Highlight API
 */
export function isCustomHighlightSupported(): boolean {
    return Boolean(getCSSHighlightsRegistry() && getHighlightConstructor());
}

/**
 * 遍历收集指定 DOM 容器中的有效文本节点，过滤掉脚本、样式、SVG及隐藏节点
 */
export function collectVisibleTextSegments(root: HTMLElement): { segments: TextSegment[]; fullText: string } {
    const segments: TextSegment[] = [];
    if (!root || !root.isConnected) return { segments, fullText: "" };

    const doc = root.ownerDocument || document;
    const walker = doc.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node: Node) {
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;

                const tag = parent.tagName.toUpperCase();
                if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "SVG") {
                    return NodeFilter.FILTER_REJECT;
                }
                if (parent.closest("[aria-hidden='true'], [hidden], .glean-reader__find-bar")) {
                    return NodeFilter.FILTER_REJECT;
                }

                const text = node.nodeValue || "";
                if (text.length === 0) return NodeFilter.FILTER_REJECT;

                return NodeFilter.FILTER_ACCEPT;
            },
        }
    );

    let offset = 0;
    let textParts: string[] = [];
    let current: Node | null = walker.nextNode();

    while (current) {
        const textNode = current as Text;
        const value = textNode.nodeValue || "";
        const len = value.length;
        if (len > 0) {
            segments.push({
                node: textNode,
                start: offset,
                end: offset + len,
                length: len,
            });
            textParts.push(value);
            offset += len;
        }
        current = walker.nextNode();
    }

    return { segments, fullText: textParts.join("") };
}

/**
 * 将累加字符区间映射到真实的 DOM Range
 */
export function mapOffsetsToRange(
    doc: Document,
    segments: TextSegment[],
    startOffset: number,
    endOffset: number
): Range | null {
    if (segments.length === 0 || startOffset >= endOffset) return null;

    // 定位 start 所在的 segment
    let startSegment: TextSegment | null = null;
    let endSegment: TextSegment | null = null;

    for (const segment of segments) {
        if (!startSegment && startOffset >= segment.start && startOffset < segment.end) {
            startSegment = segment;
        }
        if (endOffset > segment.start && endOffset <= segment.end) {
            endSegment = segment;
            break;
        }
    }

    if (!startSegment || !endSegment) return null;

    try {
        const range = doc.createRange();
        range.setStart(startSegment.node, startOffset - startSegment.start);
        range.setEnd(endSegment.node, endOffset - endSegment.start);
        return range;
    } catch {
        return null;
    }
}

export class ReaderDOMSearchController {
    private root: HTMLElement | null = null;
    private state: ReaderSearchState = initialReaderSearchState();
    private matches: DOMSearchMatch[] = [];
    private stateChangeListeners: Array<(state: ReaderSearchState) => void> = [];

    constructor(root?: HTMLElement | null) {
        if (root) {
            this.root = root;
        }
    }

    public setRoot(root: HTMLElement | null): void {
        if (this.root === root) return;
        this.clearHighlights();
        this.root = root;
        if (this.state.open && this.state.keyword) {
            this.performSearch(this.state.keyword, this.state.caseSensitive);
        }
    }

    public subscribe(listener: (state: ReaderSearchState) => void): () => void {
        this.stateChangeListeners.push(listener);
        listener(this.state);
        return () => {
            const index = this.stateChangeListeners.indexOf(listener);
            if (index >= 0) this.stateChangeListeners.splice(index, 1);
        };
    }

    public getState(): ReaderSearchState {
        return this.state;
    }

    public open(initialKeyword = ""): void {
        const keyword = initialKeyword || this.state.keyword;
        this.state = {
            ...this.state,
            open: true,
            keyword,
        };
        this.notifyState();
        if (keyword) {
            this.performSearch(keyword, this.state.caseSensitive);
        }
    }

    public close(): void {
        this.clearHighlights();
        this.matches = [];
        this.state = {
            ...this.state,
            open: false,
            activeIndex: -1,
            totalMatches: 0,
        };
        this.notifyState();
    }

    public toggle(): void {
        if (this.state.open) {
            this.close();
        } else {
            this.open();
        }
    }

    public setCaseSensitive(caseSensitive: boolean): void {
        if (this.state.caseSensitive === caseSensitive) return;
        this.state = {
            ...this.state,
            caseSensitive,
        };
        this.notifyState();
        if (this.state.keyword) {
            this.performSearch(this.state.keyword, caseSensitive);
        }
    }

    public search(keyword: string): void {
        const normalized = normalizeSearchKeyword(keyword);
        if (this.state.keyword === normalized && this.matches.length > 0) {
            return;
        }
        this.state = {
            ...this.state,
            keyword: normalized,
        };
        this.notifyState();
        this.performSearch(normalized, this.state.caseSensitive);
    }

    public next(): void {
        if (this.matches.length === 0) return;
        const newIndex = calculateMatchIndex(this.state.activeIndex, this.matches.length, "next");
        this.setActiveMatch(newIndex, true);
    }

    public prev(): void {
        if (this.matches.length === 0) return;
        const newIndex = calculateMatchIndex(this.state.activeIndex, this.matches.length, "prev");
        this.setActiveMatch(newIndex, true);
    }

    public getMatches(): DOMSearchMatch[] {
        return this.matches;
    }

    public getActiveMatch(): DOMSearchMatch | null {
        if (this.state.activeIndex >= 0 && this.state.activeIndex < this.matches.length) {
            return this.matches[this.state.activeIndex];
        }
        return null;
    }

    public dispose(): void {
        this.clearHighlights();
        this.matches = [];
        this.stateChangeListeners = [];
        this.root = null;
    }

    private notifyState(): void {
        for (const listener of this.stateChangeListeners) {
            listener(this.state);
        }
    }

    private performSearch(keyword: string, caseSensitive: boolean): void {
        this.clearHighlights();
        this.matches = [];

        if (!this.root || !this.root.isConnected || !keyword.trim()) {
            this.state = {
                ...this.state,
                activeIndex: -1,
                totalMatches: 0,
            };
            this.notifyState();
            return;
        }

        const { segments, fullText } = collectVisibleTextSegments(this.root);
        if (segments.length === 0 || !fullText) {
            this.state = {
                ...this.state,
                activeIndex: -1,
                totalMatches: 0,
            };
            this.notifyState();
            return;
        }

        const offsets = findTextOffsets(fullText, keyword, caseSensitive);
        const doc = this.root.ownerDocument || document;
        const matches: DOMSearchMatch[] = [];

        for (let i = 0; i < offsets.length; i++) {
            const offset = offsets[i];
            const range = mapOffsetsToRange(doc, segments, offset.start, offset.end);
            if (range) {
                matches.push({
                    index: matches.length,
                    range,
                    startNode: range.startContainer as Text,
                    startOffset: range.startOffset,
                    endNode: range.endContainer as Text,
                    endOffset: range.endOffset,
                });
            }
        }

        this.matches = matches;
        const activeIndex = matches.length > 0 ? 0 : -1;
        this.state = {
            ...this.state,
            activeIndex,
            totalMatches: matches.length,
        };
        this.notifyState();

        this.applyHighlights();
        if (activeIndex >= 0) {
            this.scrollToMatch(matches[activeIndex]);
        }
    }

    private setActiveMatch(index: number, scroll = false): void {
        if (index < 0 || index >= this.matches.length) return;
        this.state = {
            ...this.state,
            activeIndex: index,
        };
        this.notifyState();
        this.applyHighlights();
        if (scroll) {
            this.scrollToMatch(this.matches[index]);
        }
    }

    private applyHighlights(): void {
        const highlightRegistry = getCSSHighlightsRegistry();
        const HighlightConstructor = getHighlightConstructor();
        if (!highlightRegistry || !HighlightConstructor) return;

        try {
            // 现代浏览器中 CSS.highlights 是一个全局 Map
            // 移除旧的高亮
            highlightRegistry.delete(HIGHLIGHT_NAME_ALL);
            highlightRegistry.delete(HIGHLIGHT_NAME_ACTIVE);

            if (this.matches.length === 0) return;

            const allRanges = this.matches.map((m) => m.range);
            const activeRange = this.getActiveMatch()?.range;

            const allHighlight = new HighlightConstructor(...allRanges);
            highlightRegistry.set(HIGHLIGHT_NAME_ALL, allHighlight);

            if (activeRange) {
                const activeHighlight = new HighlightConstructor(activeRange);
                highlightRegistry.set(HIGHLIGHT_NAME_ACTIVE, activeHighlight);
            }
        } catch {
            // 静默容错
        }
    }

    private clearHighlights(): void {
        const highlightRegistry = getCSSHighlightsRegistry();
        if (!highlightRegistry) return;
        try {
            highlightRegistry.delete(HIGHLIGHT_NAME_ALL);
            highlightRegistry.delete(HIGHLIGHT_NAME_ACTIVE);
        } catch {
            // 静默容错
        }
    }

    private scrollToMatch(match: DOMSearchMatch | null): void {
        if (!match) return;
        try {
            const element = match.range.startContainer.parentElement;
            if (element && typeof element.scrollIntoView === "function") {
                element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
            }
        } catch {
            // 静默容错
        }
    }
}
