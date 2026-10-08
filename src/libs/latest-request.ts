export function createLatestRequestGate() {
    let generation = 0;
    return {
        begin(): () => boolean {
            const current = ++generation;
            return () => current === generation;
        },
        invalidate(): void {
            generation += 1;
        },
    };
}
