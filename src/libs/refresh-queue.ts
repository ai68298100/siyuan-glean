export function createRefreshQueue(refresh: () => Promise<void>): () => Promise<void> {
    let current: Promise<void> | null = null;
    let requested = false;

    async function run() {
        do {
            requested = false;
            await refresh();
        } while (requested);
    }

    return () => {
        if (current) {
            requested = true;
            return current;
        }
        current = run().finally(() => {
            current = null;
        });
        return current;
    };
}
