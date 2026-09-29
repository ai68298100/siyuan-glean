<script lang="ts">
    /**
     * 一篇剪藏的统一状态动作（S3）。
     *
     * 状态动作只通过父组件传入的回调落到 clip-store；这个组件不读写属性，
     * 因而可以在 Dock、桌面行表、看板和移动端共用同一套语义。
     */
    import type { ClipStatus } from "../domain/schema";
    import type { I18nBundle } from "../libs/i18n";
    import { t } from "../libs/i18n";

    interface Props {
        i18n: I18nBundle;
        status: ClipStatus;
        disabled?: boolean;
        onStartReading: () => void | Promise<void>;
        onSetStatus: (status: ClipStatus) => void | Promise<void>;
    }

    let { i18n, status, disabled = false, onStartReading, onSetStatus }: Props = $props();
    let pending = $state(false);

    async function invoke(action: () => void | Promise<void>) {
        if (disabled || pending) return;
        pending = true;
        try {
            await action();
        } finally {
            pending = false;
        }
    }

    function stop(event: Event) {
        event.stopPropagation();
    }

    function labelForStart(): string {
        if (status === "reading") return t(i18n, "action.continueReading");
        if (status === "done") return t(i18n, "action.readAgain");
        return t(i18n, "action.startReading");
    }
</script>

<div class="glean-status-actions" aria-label={t(i18n, "action.statusActions")}>
    {#if status === "archived"}
        <button
            class="glean-status-actions__btn glean-status-actions__btn--restore"
            disabled={disabled || pending}
            title={t(i18n, "action.restore")}
            onclick={(event) => { stop(event); void invoke(() => onSetStatus("later")); }}
        ><span aria-hidden="true">↩</span><span>{t(i18n, "action.restore")}</span></button>
    {:else}
        <button
            class="glean-status-actions__btn glean-status-actions__btn--primary"
            disabled={disabled || pending}
            title={labelForStart()}
            onclick={(event) => { stop(event); void invoke(onStartReading); }}
        ><span aria-hidden="true">▶</span><span>{labelForStart()}</span></button>

        <button
            class="glean-status-actions__btn"
            disabled={disabled || pending || status === "later"}
            title={t(i18n, "action.moveToLater")}
            onclick={(event) => { stop(event); void invoke(() => onSetStatus("later")); }}
        ><span aria-hidden="true">↷</span><span>{t(i18n, "action.moveToLater")}</span></button>

        <button
            class="glean-status-actions__btn"
            disabled={disabled || pending || status === "done"}
            title={t(i18n, "action.markDone")}
            onclick={(event) => { stop(event); void invoke(() => onSetStatus("done")); }}
        ><span aria-hidden="true">✓</span><span>{t(i18n, "action.markDone")}</span></button>

        <button
            class="glean-status-actions__btn glean-status-actions__btn--archive"
            disabled={disabled || pending}
            title={t(i18n, "action.archive")}
            onclick={(event) => { stop(event); void invoke(() => onSetStatus("archived")); }}
        ><span aria-hidden="true">⤓</span><span>{t(i18n, "action.archive")}</span></button>
    {/if}
</div>
