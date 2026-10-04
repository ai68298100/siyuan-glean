export type SurfaceSwipeAction = "later" | "archive";

export const SURFACE_SWIPE_THRESHOLD = 72;
export const SURFACE_SWIPE_MAX_OFFSET = 132;

export function clampSurfaceSwipe(deltaX: number): number {
    return Math.max(-SURFACE_SWIPE_MAX_OFFSET, Math.min(SURFACE_SWIPE_MAX_OFFSET, deltaX));
}

export function resolveSurfaceSwipe(
    deltaX: number,
    deltaY: number,
    threshold: number = SURFACE_SWIPE_THRESHOLD,
): SurfaceSwipeAction | null {
    if (Math.abs(deltaX) < threshold || Math.abs(deltaX) <= Math.abs(deltaY)) return null;
    return deltaX > 0 ? "later" : "archive";
}
