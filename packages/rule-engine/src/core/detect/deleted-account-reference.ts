export function isDeletedAccount(accountId: string, validIds: Set<string>): boolean {
    return !validIds.has(accountId);
}
