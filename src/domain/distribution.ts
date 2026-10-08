import type { NameCount } from "./stats.ts";

export function summarizeDistribution(counts: readonly NameCount[], limit = 8): { top: NameCount[]; others: NameCount[]; otherCount: number } {
    const size = Number.isSafeInteger(limit) && limit > 0 ? limit : 8;
    const sorted = counts.filter((group) => group.name.trim() && Number.isSafeInteger(group.count) && group.count > 0)
        .map((group) => ({ ...group }))
        .sort((first, second) => second.count - first.count || (first.name < second.name ? -1 : first.name > second.name ? 1 : 0));
    const others = sorted.slice(size);
    return { top: sorted.slice(0, size), others, otherCount: others.reduce((total, group) => total + group.count, 0) };
}
