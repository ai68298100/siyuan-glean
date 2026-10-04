import { svelteDialog } from "../libs/dialog";
import { t } from "../libs/i18n";
import type { GleanFacade } from "../types";
import FormattingDialog from "./FormattingDialog.svelte";

export function openFormattingDialog(facade: GleanFacade, docId: string): void {
    if (!docId) return;
    svelteDialog({
        title: t(facade.i18n, "formatting.title"),
        closeLabel: t(facade.i18n, "action.close"),
        component: FormattingDialog,
        props: { facade, docId },
        width: "min(960px, 94vw)",
        height: "min(850px, 88vh)",
    });
}
