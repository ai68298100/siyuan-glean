/**
 * 读库全键盘操作流的键位仲裁与光标移动（T-3392）。
 *
 * Readwise Reader 风格的 J/K 分拣需要同时满足三件事：
 * 1. 不抢宿主与浏览器已有的按键（输入框、按钮、弹层里的 Enter/Escape）；
 * 2. 输入法组合期间一律不响应，避免中文候选词被当成命令；
 * 3. 破坏性动作（归档、改稍后读）忽略长按重复，防止一次按键误伤整列。
 *
 * 本层只做纯函数判定，不读 DOM、不依赖 Svelte；焦点与渲染由 DockPanel 负责。
 */

export type LibraryKeyboardAction =
    | { type: "move"; delta: 1 | -1 }
    | { type: "activate" }
    | { type: "openDocument" }
    | { type: "startReading" }
    | { type: "later" }
    | { type: "archive" }
    | { type: "toggleSelect" }
    | { type: "clearCursor" };

export interface LibraryKeyboardEventLike {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    isComposing?: boolean;
    keyCode?: number;
    repeat?: boolean;
}

export interface LibraryKeyboardContext {
    /** 焦点在文本输入类控件（input/textarea/select/contenteditable）中。 */
    textEntry?: boolean;
    /** 焦点在按钮、链接等自带 Enter 语义的元素上。 */
    nativeAction?: boolean;
    /** 插件内或宿主已有弹层/菜单打开。 */
    overlay?: boolean;
    /** 键盘光标是否已经落在某一行；未激活时只允许 J/K 起步。 */
    cursorActive?: boolean;
}

/** 长按重复时不重复执行的破坏性动作。 */
const REPEAT_SENSITIVE = new Set<LibraryKeyboardAction["type"]>(["activate", "openDocument", "startReading", "later", "archive", "toggleSelect"]);

/**
 * 把一次按键解析成读库动作；返回 null 表示应完全交还原生处理。
 *
 * 键位：J / ↓ 下一行，K / ↑ 上一行，Enter 查看，O 打开原文，
 * R 开始阅读，A 稍后读，E 归档，X 切换选择，Escape 退出键盘光标。
 */
export function resolveLibraryShortcut(
    event: LibraryKeyboardEventLike,
    context: LibraryKeyboardContext = {},
): LibraryKeyboardAction | null {
    if (event.isComposing || event.keyCode === 229) return null;
    if (event.ctrlKey || event.metaKey || event.altKey) return null;
    if (context.overlay || context.textEntry) return null;
    // 大写字母通常是 Shift+字母，不作为命令；避免 Shift+E 被当成归档。
    if (event.shiftKey) return null;

    const key = event.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;
    if (key === "Escape") return context.cursorActive ? { type: "clearCursor" } : null;

    const cursorActive = context.cursorActive === true;
    if (lower === "j" || (key === "ArrowDown" && cursorActive)) {
        return repeatOrNull(event, { type: "move", delta: 1 });
    }
    if (lower === "k" || (key === "ArrowUp" && cursorActive)) {
        return repeatOrNull(event, { type: "move", delta: -1 });
    }
    // Enter 在按钮/链接上保留原生点击语义；只有焦点在行容器时才接管。
    if (key === "Enter" && !context.nativeAction && cursorActive) {
        return repeatOrNull(event, { type: "activate" });
    }
    if (!cursorActive) return null;

    if (lower === "o") return repeatOrNull(event, { type: "openDocument" });
    if (lower === "r") return repeatOrNull(event, { type: "startReading" });
    if (lower === "a") return repeatOrNull(event, { type: "later" });
    if (lower === "e") return repeatOrNull(event, { type: "archive" });
    if (lower === "x") return repeatOrNull(event, { type: "toggleSelect" });
    return null;
}

function repeatOrNull(event: LibraryKeyboardEventLike, action: LibraryKeyboardAction): LibraryKeyboardAction | null {
    if (event.repeat && REPEAT_SENSITIVE.has(action.type)) return null;
    return action;
}

/**
 * 计算键盘光标的下一个位置。
 *
 * - 当前光标不在列表里（首次进入或被筛选移除）：正向从第一项开始，反向从最后一项开始；
 * - 到达两端后保持不动，不回绕，避免长按 J 从「待分拣」直接跳到「已归档」。
 */
export function moveLibraryCursor(ids: readonly string[], currentId: string, delta: 1 | -1): string {
    if (ids.length === 0) return "";
    const index = currentId ? ids.indexOf(currentId) : -1;
    if (index < 0) return delta > 0 ? ids[0] : ids[ids.length - 1];
    const next = Math.min(ids.length - 1, Math.max(0, index + delta));
    return ids[next];
}

/** 供 UI 决定是否显示「已用键盘选中」提示。 */
export function isLibraryCursorVisible(currentId: string, ids: readonly string[]): boolean {
    return Boolean(currentId) && ids.includes(currentId);
}
