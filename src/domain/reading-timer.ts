/**
 * 前台真实阅读计时的纯状态机（T-3272）。
 * 只累计阅读页签处于可见、获焦、正文宿主已渲染的时间；写回由 services/clip-store 负责。
 */

export interface ReadingTimerState {
    totalSeconds: number;
    activeSince: number | null;
}

export interface ReadingTimerEligibility {
    visible: boolean;
    focused: boolean;
    hostReady: boolean;
    contentType?: string;
    bodyState?: string;
}

const finiteTimestamp = (value: number): number | null => Number.isFinite(value) ? Math.max(0, value) : null;

export function createReadingTimer(readMinutes = 0): ReadingTimerState {
    const minutes = Number.isFinite(readMinutes) ? Math.max(0, Math.floor(readMinutes)) : 0;
    return { totalSeconds: minutes * 60, activeSince: null };
}

export function advanceReadingTimer(state: ReadingTimerState, now: number): ReadingTimerState {
    const timestamp = finiteTimestamp(now);
    if (timestamp === null || state.activeSince === null) return { ...state };
    const elapsed = Math.max(0, Math.floor((timestamp - state.activeSince) / 1000));
    return { totalSeconds: state.totalSeconds + elapsed, activeSince: timestamp };
}

export function setReadingTimerActive(state: ReadingTimerState, active: boolean, now: number): ReadingTimerState {
    const advanced = advanceReadingTimer(state, now);
    return { ...advanced, activeSince: active ? finiteTimestamp(now) : null };
}

export function readingTimerMinutes(state: ReadingTimerState): number {
    return Math.max(0, Math.floor(state.totalSeconds / 60));
}

export function canCountReading(input: ReadingTimerEligibility): boolean {
    return input.visible
        && input.focused
        && input.hostReady
        && input.contentType !== "link"
        && input.bodyState !== "missing"
        && input.bodyState !== "na";
}
