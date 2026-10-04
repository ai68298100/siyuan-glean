export interface MobileViewportMetrics {
    innerHeight: number;
    viewportHeight: number;
    viewportOffsetTop?: number;
}

function finiteNonNegative(value: number | undefined): number {
    return Number.isFinite(value) ? Math.max(0, value as number) : 0;
}

export function mobileKeyboardInset(metrics: MobileViewportMetrics): number {
    const innerHeight = finiteNonNegative(metrics.innerHeight);
    const viewportHeight = finiteNonNegative(metrics.viewportHeight);
    const viewportOffsetTop = finiteNonNegative(metrics.viewportOffsetTop);
    return Math.max(0, Math.round(innerHeight - viewportHeight - viewportOffsetTop));
}

export function isMobileKeyboardOpen(metrics: MobileViewportMetrics, threshold = 80): boolean {
    const normalizedThreshold = Number.isFinite(threshold) ? Math.max(0, threshold) : 80;
    return mobileKeyboardInset(metrics) >= normalizedThreshold;
}
