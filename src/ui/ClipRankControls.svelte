<script lang="ts">
    /** 显式的优先级/评分入口（T-1708）。修改由父组件经 clip-store 写回文档属性。 */
    import type { I18nBundle } from "../libs/i18n";
    import { t } from "../libs/i18n";

    interface Props {
        i18n: I18nBundle;
        priority?: number;
        rating?: number;
        disabled?: boolean;
        onPriority: (value: number) => void | Promise<void>;
        onRating: (value: number) => void | Promise<void>;
    }

    let { i18n, priority, rating, disabled = false, onPriority, onRating }: Props = $props();

</script>

<div class="glean-rank-controls" role="group" aria-label={t(i18n, "action.rankActions")}>
    <label class="glean-rank-controls__field">
        <span>{t(i18n, "action.priority")}</span>
        <select
            class="b3-select"
            aria-label={t(i18n, "action.priority")}
            value={priority ?? 3}
            disabled={disabled}
            onclick={(event) => event.stopPropagation()}
            onchange={(event) => { event.stopPropagation(); void onPriority(Number((event.currentTarget as HTMLSelectElement).value)); }}
        >
            {#each [1, 2, 3, 4, 5] as value}
                <option value={value}>{value}</option>
            {/each}
        </select>
    </label>
    <label class="glean-rank-controls__field">
        <span>{t(i18n, "action.rating")}</span>
        <select
            class="b3-select"
            aria-label={t(i18n, "action.rating")}
            value={rating ?? 0}
            disabled={disabled}
            onclick={(event) => event.stopPropagation()}
            onchange={(event) => { event.stopPropagation(); void onRating(Number((event.currentTarget as HTMLSelectElement).value)); }}
        >
            {#each [0, 1, 2, 3, 4, 5] as value}
                <option value={value}>{value === 0 ? "—" : `${value} ★`}</option>
            {/each}
        </select>
    </label>
</div>
