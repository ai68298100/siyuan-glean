export const DEFAULT_PREVIEW_RATIO = 0.45;
export const MIN_PREVIEW_RATIO = 0.25;
export const MAX_PREVIEW_RATIO = 0.65;

export function normalizePreviewRatio(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value)
        ? Math.min(MAX_PREVIEW_RATIO, Math.max(MIN_PREVIEW_RATIO, value))
        : DEFAULT_PREVIEW_RATIO;
}

export function previewRatioFromPointer(clientX: number, right: number, width: number): number | null {
    if (![clientX, right, width].every(Number.isFinite) || width <= 0) return null;
    return normalizePreviewRatio((right - clientX) / width);
}

export function nextPreviewId(before: readonly string[], after: readonly string[], processed: string): string {
    const position = before.indexOf(processed);
    if (position < 0) return "";
    const available = new Set(after);
    return before.slice(position + 1).find((id) => available.has(id))
        ?? before.slice(0, position).reverse().find((id) => available.has(id))
        ?? "";
}
