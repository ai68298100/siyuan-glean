<script lang="ts">
    /** T-3364：真实组件的合成状态点验，不连接内核或保存文章。 */
    import { untrack } from "svelte";
    import ResurfaceView from "../../../src/ui/ResurfaceView.svelte";
    import type { GleanFacade } from "../../../src/types";
    import type { ClipIndexEntry, GleanIndex } from "../../../src/services/index-store";

    let { facade, scenario }: { facade: GleanFacade; scenario: string } = $props();
    let activeState = $state(untrack(() => scenario));
    let tagsRemoved = $state(false);
    const currentTime = new Date("2026-10-18T12:00:00+08:00");
    const longTag = "LONG_TAG_" + "topic".repeat(24);
    const contextFacade = $derived({ ...facade, settings: { ...facade.settings, anchorNotebooks: ["preview-box"] } });

    function clip(id: string, patch: Partial<ClipIndexEntry>): ClipIndexEntry {
        return {
            id, title: id, hpath: "/合成样本/" + id, box: "preview-box", status: "inbox",
            url: "", site: "", tags: ["工作"], src: "manual", time: "20261001080000",
            doneTime: "", words: 1000, minutes: 5, priority: 3, rating: 0, favorite: false,
            surfaced: "", summary: "", snapshot: "", aiTags: [], contentType: "fulltext",
            timeSource: "document", updated: "20261001080000", ...patch,
        };
    }

    const index: GleanIndex = $derived.by(() => {
        if (activeState === "loading" || activeState === "failure") {
            return { version: 1, updatedAt: "", clips: {}, candidates: {} };
        }
        const entries = activeState === "empty" ? []
            : activeState === "unknown" ? [clip("unknown", { title: "合成：阅读时长尚未补齐", minutes: 0 })]
            : activeState === "source-missing" ? [clip("missing-source", { title: "合成：仅链接条目缺少来源", contentType: "link" })]
            : [
                clip("long-content", { title: "合成：长标题与长主题-" + "UnbrokenArticleTitle".repeat(9), tags: tagsRemoved ? ["已更新主题"] : [longTag], priority: 5 }),
                clip("local", { title: "合成：五分钟本地文章", contentType: "local", status: "later", priority: 4 }),
                clip("done", { title: "合成：已明确读完的文章", status: "done", priority: 5, doneTime: "20261015080000" }),
                clip("unknown", { title: "合成：阅读时长尚未补齐", minutes: 0 }),
                clip("over-budget", { title: "合成：需要三十分钟", minutes: 30 }),
            ];
        return { version: 1, updatedAt: "20261018080000", clips: Object.fromEntries(entries.map((entry) => [entry.id, entry])), candidates: {} };
    });
</script>

<div class="glean-preview-tools" role="group" aria-label="合成场景控制">
    <span>合成点验：真实组件 / 无内核连接</span>
    <button type="button" onclick={() => tagsRemoved = !tagsRemoved}>{tagsRemoved ? "恢复长主题" : "移除长主题"}</button>
</div>
<div class="glean-panel glean-preview-context" class:glean-panel--mobile={facade.isMobile}>
    <div class="glean-panel__body">
        <ResurfaceView facade={contextFacade} {index} {currentTime} loading={activeState === "loading"} loadError={activeState === "failure"} onRetry={() => activeState = "default"} onMutated={() => {}} embedded />
    </div>
</div>
