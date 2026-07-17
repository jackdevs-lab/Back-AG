export function isBrokenLink(targetId: string, validIds: Set<string>): boolean {
    return !validIds.has(targetId);
}
