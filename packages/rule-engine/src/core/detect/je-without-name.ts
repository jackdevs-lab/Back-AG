// core/detect/je-without-name.ts

/**
 * Detects if a journal entry has any lines missing a required Entity name.
 */
export function hasMissingName(linesMissingName: any[]): boolean {
    return linesMissingName.length > 0;
}
