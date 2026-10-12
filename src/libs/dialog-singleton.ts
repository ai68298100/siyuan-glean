type DialogHandle = {
    dialog: { element: HTMLElement };
};

/** Keep one live dialog per opener and release it only when that exact dialog closes. */
export function createDialogSingleton<Args, Handle extends DialogHandle>(
    create: (args: Args, onClose: () => void) => Handle,
): (args: Args) => Handle {
    let active: Handle | null = null;

    return (args) => {
        if (active?.dialog.element.isConnected) {
            active.dialog.element.querySelector<HTMLElement>(".b3-dialog__container")?.focus({ preventScroll: true });
            return active;
        }

        active = null;
        let created!: Handle;
        let closedDuringCreation = false;
        created = create(args, () => {
            closedDuringCreation = true;
            if (active === created) active = null;
        });
        if (!closedDuringCreation) active = created;
        return created;
    };
}
