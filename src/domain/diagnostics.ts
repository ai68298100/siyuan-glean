export interface AnonymousDiagnostic {
    version: 1;
    pluginVersion: string;
    apiVersion: string;
    index: { updatedAt: string; fresh: boolean; clipCount: number; candidateCount: number };
    featureSwitches: Record<string, boolean>;
    frontend: string;
    failure?: { phase: string };
}

export function renderDiagnosticJson(diagnostic: AnonymousDiagnostic): string {
    return JSON.stringify(diagnostic, null, 2);
}
