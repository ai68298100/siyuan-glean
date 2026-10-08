export type ReaderShortcut = "scrollDown" | "scrollUp" | "edit" | "done" | "excerpt" | "help";

export interface ReaderKeyInput {
    key: string;
    mode: "read" | "edit";
    focused: boolean;
    blocked: boolean;
    defaultPrevented?: boolean;
    isComposing?: boolean;
    keyCode?: number;
    ctrlKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    repeat?: boolean;
}

export function readerShortcut(input: ReaderKeyInput): ReaderShortcut | null {
    if (input.mode !== "read" || !input.focused || input.blocked || input.defaultPrevented
        || input.isComposing || input.keyCode === 229 || input.ctrlKey || input.altKey || input.metaKey) return null;
    if (input.shiftKey && input.key !== "?") return null;
    const shortcut: ReaderShortcut | null = input.key === "j" ? "scrollDown"
        : input.key === "k" ? "scrollUp"
        : input.key === "e" ? "edit"
        : input.key === "m" ? "done"
        : input.key === "x" ? "excerpt"
        : input.key === "?" ? "help" : null;
    if (input.repeat && shortcut !== "scrollDown" && shortcut !== "scrollUp") return null;
    return shortcut;
}
