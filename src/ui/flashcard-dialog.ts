import { svelteDialog } from "../libs/dialog";
import { t } from "../libs/i18n";
import type { FlashcardSource } from "../domain/flashcard";
import type { GleanFacade } from "../types";
import FlashcardDialog from "./FlashcardDialog.svelte";

export function makeQuoteCardPreview(facade: GleanFacade, source: FlashcardSource): void {
    if (!source.quote.trim()) return;
    svelteDialog({
        title: t(facade.i18n, "flashcard.previewTitle"),
        closeLabel: t(facade.i18n, "action.close"),
        component: FlashcardDialog,
        props: { facade, source },
        width: "min(820px, 94vw)",
        height: "min(820px, 88vh)",
    });
}
