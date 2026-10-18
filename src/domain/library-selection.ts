/** Selection is a session set; rendering and filters only describe its scope. */
export function librarySelectionScope(
    selection: ReadonlySet<string>,
    filteredIds: Iterable<string>,
    displayedIds: Iterable<string>,
) {
    const filtered = new Set(filteredIds);
    const displayed = new Set(displayedIds);
    let filteredSelectedCount = 0;
    let displayedSelectedCount = 0;
    for (const id of selection) {
        if (filtered.has(id)) filteredSelectedCount += 1;
        if (displayed.has(id)) displayedSelectedCount += 1;
    }
    return {
        selectedCount: selection.size,
        hiddenCount: selection.size - filteredSelectedCount,
        displayedCount: displayed.size,
        displayedSelectedCount,
    };
}

export function addDisplayedSelection(selection: ReadonlySet<string>, displayedIds: Iterable<string>): ReadonlySet<string> {
    return new Set([...selection, ...displayedIds]);
}

export function retainFilteredSelection(selection: ReadonlySet<string>, filteredIds: Iterable<string>): ReadonlySet<string> {
    const filtered = new Set(filteredIds);
    return new Set([...selection].filter((id) => filtered.has(id)));
}
