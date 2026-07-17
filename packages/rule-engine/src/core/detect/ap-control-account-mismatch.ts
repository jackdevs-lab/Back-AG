// core/detect/ap-control-account-mismatch.ts

export function isMismatch(variance: any, tolerance: any): boolean {
    return variance.gt(tolerance);
}
