/** Map stable AI transport failures to safe, localized user feedback. */
export function aiFailureKey(reason?: string): string | null {
    if (reason === "permission" || reason === "network" || reason === "timeout") return `ai.failure.${reason}`;
    return null;
}
