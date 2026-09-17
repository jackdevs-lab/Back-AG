// packages/utils/src/byteSize.ts (new)
export function byteSize(value: unknown): number {
    return Buffer.byteLength(JSON.stringify(value));
}