import { byteSize } from './byteSize';

/**
 * Splits `items` into chunks where the sum of serialized byte sizes
 * of each chunk stays at or below `maxBytes`.
 *
 * A single item larger than `maxBytes` is still placed in its own chunk
 * (callers should enforce a per-row cap separately — see MAX_ROW_BYTES).
 */
export function chunkByBytes<T>(
    items: T[],
    maxBytes: number,
    measure: (item: T) => number = byteSize
): T[][] {
    const chunks: T[][] = [];
    let current: T[] = [];
    let currentBytes = 0;

    for (const item of items) {
        const size = measure(item);

        if (currentBytes + size > maxBytes && current.length > 0) {
            chunks.push(current);
            current = [];
            currentBytes = 0;
        }

        current.push(item);
        currentBytes += size;
    }

    if (current.length > 0) chunks.push(current);
    return chunks;
}