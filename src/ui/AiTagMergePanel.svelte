<script lang="ts">
    import { t } from "../libs/i18n";
    import { applyAiTagMerge, suggestAiTagMerges, type AiTagMergePlan } from "../services/ai-tag-service";
    import type { GleanFacade } from "../types";

    interface Props { facade: GleanFacade }
    let { facade }: Props = $props();
    const i18n = $derived(facade.i18n);
    const instanceId = $props.id();
    const titleId = `glean-ai-tag-merge-title-${instanceId}`;
    let plans = $state<AiTagMergePlan[]>([]);
    let keepByGroup = $state<Record<string, string>>({});
    let busy = $state<"scan" | string | "">("");
    let scanned = $state(false);
    let error = $state(false);
    let message = $state("");

    function keyOf(plan: AiTagMergePlan): string {
        return plan.variants.join("\u0000");
    }

    function keepOf(plan: AiTagMergePlan): string {
        return keepByGroup[keyOf(plan)] ?? plan.keep;
    }

    function setKeep(plan: AiTagMergePlan, event: Event): void {
        const value = (event.currentTarget as HTMLSelectElement).value;
        keepByGroup = { ...keepByGroup, [keyOf(plan)]: value };
    }

    async function runScan(setError = true): Promise<boolean> {
        try {
            plans = await suggestAiTagMerges(facade.pluginInstance);
            keepByGroup = Object.fromEntries(plans.map((plan) => [keyOf(plan), plan.keep]));
            scanned = true;
            return true;
        } catch {
            plans = [];
            keepByGroup = {};
            scanned = false;
            if (setError) error = true;
            return false;
        }
    }

    async function scan(): Promise<void> {
        if (busy) return;
        busy = "scan";
        error = false;
        message = "";
        try { await runScan(); } finally { busy = ""; }
    }

    async function apply(plan: AiTagMergePlan): Promise<void> {
        if (busy) return;
        const keep = keepOf(plan);
        if (!plan.variants.includes(keep)) return;
        busy = keyOf(plan);
        error = false;
        message = "";
        try {
            const changed = await applyAiTagMerge(facade.pluginInstance, plan.variants, keep);
            facade.notifyDataChanged();
            message = t(i18n, "aiTagMerge.applied", { n: changed });
            // 合并已生效：随后的重扫失败只影响列表刷新，不把成功提示吞成错误
            await runScan(false);
        } catch {
            error = true;
        } finally {
            busy = "";
        }
    }
</script>

<section class="glean-ai-tag-merge" aria-labelledby={titleId} aria-busy={Boolean(busy)}>
    <div class="glean-ai-tag-merge__head">
        <div>
            <h3 id={titleId}>{t(i18n, "aiTagMerge.title")}</h3>
            <p>{t(i18n, "aiTagMerge.desc")}</p>
        </div>
        <button class="glean-btn glean-btn--ghost" disabled={Boolean(busy)} onclick={() => void scan()}>
            {busy === "scan" ? t(i18n, "aiTagMerge.scanning") : t(i18n, "aiTagMerge.scan")}
        </button>
    </div>

    {#if error}
        <p class="glean-ai-tag-merge__status glean-ai-tag-merge__status--error" role="alert">{t(i18n, "aiTagMerge.error")}</p>
    {:else if message}
        <p class="glean-ai-tag-merge__status" role="status" aria-live="polite">{message}</p>
    {/if}

    {#if scanned && plans.length === 0}
        <p class="glean-ai-tag-merge__empty" role="status">{t(i18n, "aiTagMerge.empty")}</p>
    {:else if plans.length > 0}
        <div class="glean-ai-tag-merge__list">
            {#each plans as plan (keyOf(plan))}
                <div class="glean-ai-tag-merge__row">
                    <div class="glean-ai-tag-merge__variants">
                        {#each plan.variants as variant (variant)}<span class="glean-chip">{variant}</span>{/each}
                    </div>
                    <span class="glean-ai-tag-merge__affected">{t(i18n, "aiTagMerge.affected", { n: plan.affected })}</span>
                    <label class="glean-ai-tag-merge__keep">
                        <span>{t(i18n, "aiTagMerge.keep")}</span>
                        <select class="b3-select" value={keepOf(plan)} onchange={(event) => setKeep(plan, event)} disabled={Boolean(busy)}>
                            {#each plan.variants as variant (variant)}<option value={variant}>{variant}</option>{/each}
                        </select>
                    </label>
                    <button class="glean-btn glean-btn--pri" disabled={Boolean(busy)} aria-busy={busy === keyOf(plan)} onclick={() => void apply(plan)}>
                        {busy === keyOf(plan) ? t(i18n, "aiTagMerge.applying") : t(i18n, "aiTagMerge.apply")}
                    </button>
                </div>
            {/each}
        </div>
    {:else}
        <p class="glean-ai-tag-merge__hint">{t(i18n, "aiTagMerge.hint")}</p>
    {/if}
</section>

<style>
    .glean-ai-tag-merge { display: grid; gap: var(--glean-space-3); padding: var(--glean-space-4); min-width: 0; color: var(--b3-theme-on-background); }
    .glean-ai-tag-merge h3, .glean-ai-tag-merge p { margin: 0; overflow-wrap: anywhere; }
    .glean-ai-tag-merge h3 { font-size: var(--glean-text-lg); line-height: 1.35; }
    .glean-ai-tag-merge p { color: var(--b3-theme-on-surface); font-size: var(--glean-text-sm); line-height: 1.55; }
    .glean-ai-tag-merge__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--glean-space-3); }
    .glean-ai-tag-merge__head p { margin-top: var(--glean-space-1); }
    .glean-ai-tag-merge__list { display: grid; gap: var(--glean-space-2); }
    .glean-ai-tag-merge__row { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(150px, 190px) auto; align-items: center; gap: var(--glean-space-2); padding: var(--glean-space-3); border: 1px solid var(--glean-border-soft); border-radius: var(--glean-radius-md); background: var(--glean-status-surface); }
    .glean-ai-tag-merge__variants { display: flex; flex-wrap: wrap; gap: var(--glean-space-1); min-width: 0; }
    .glean-ai-tag-merge__affected { color: var(--b3-theme-on-surface); font-size: var(--glean-text-xs); white-space: nowrap; }
    .glean-ai-tag-merge__keep { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: var(--glean-space-2); min-width: 0; color: var(--b3-theme-on-surface); font-size: var(--glean-text-xs); }
    .glean-ai-tag-merge__keep select { min-width: 0; max-width: 100%; }
    .glean-ai-tag-merge__hint, .glean-ai-tag-merge__empty { padding: var(--glean-space-2) 0; }
    .glean-ai-tag-merge__status { color: var(--glean-st-done-text) !important; }
    .glean-ai-tag-merge__status--error { color: var(--b3-theme-error) !important; }
    @media (max-width: 600px) {
        .glean-ai-tag-merge__head { display: grid; }
        .glean-ai-tag-merge__head button { justify-self: start; min-height: 44px; }
        .glean-ai-tag-merge__row { grid-template-columns: minmax(0, 1fr); }
        .glean-ai-tag-merge__affected { white-space: normal; }
        .glean-ai-tag-merge__keep { grid-template-columns: minmax(0, 1fr); }
        .glean-ai-tag-merge__row > button { min-height: 44px; }
    }
</style>
