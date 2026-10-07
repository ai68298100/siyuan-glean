<script lang="ts">
    import type { ClipStatus } from "../domain/schema";
    import type { I18nBundle } from "../libs/i18n";
    import { t } from "../libs/i18n";

    interface Props {
        i18n: I18nBundle;
        selectedCount: number;
        busy?: boolean;
        onApply: (status: ClipStatus) => void | Promise<void>;
        onOpenAi: () => void;
        onClear: () => void;
    }

    let { i18n, selectedCount, busy = false, onApply, onOpenAi, onClear }: Props = $props();
</script>

{#if selectedCount > 0}
    <footer class="glean-batchbar" aria-busy={busy}>
        <b aria-live="polite">{t(i18n, "action.selected")} {selectedCount}</b>
        <div class="glean-batchbar__ops">
            <button class="glean-bb" disabled={busy} onclick={() => void onApply("reading")}>{t(i18n, "status.reading")}</button>
            <button class="glean-bb" disabled={busy} onclick={() => void onApply("done")}>{t(i18n, "status.done")}</button>
            <button class="glean-bb glean-bb--pri" disabled={busy} onclick={() => void onApply("archived")}>{t(i18n, "action.batchArchive")}</button>
            <button class="glean-bb glean-bb--ai" disabled={busy} onclick={onOpenAi}>{t(i18n, "aiBatch.title")}</button>
            <button class="glean-bb" aria-label={t(i18n, "action.cancel")} disabled={busy} onclick={onClear}><svg class="glean-icon glean-icon--xs" aria-hidden="true"><use href="#iconGleanClose" /></svg></button>
        </div>
    </footer>
{/if}
