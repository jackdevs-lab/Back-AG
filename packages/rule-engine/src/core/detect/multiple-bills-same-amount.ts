import { NormalizedMultipleBill } from '../normalize/multiple-bills-same-amount';

/**
 * Pure detection logic for multiple bills with the same amount within a batch.
 */
export function detectMultipleBillsSameAmount(bills: NormalizedMultipleBill[], windowDays: number) {
    const groups = new Map<string, NormalizedMultipleBill[]>();

    for (const bill of bills) {
        const key = `${bill.amount.abs().toFixed(2)}|${bill.currency.toUpperCase()}`;
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push(bill);
    }

    const clusters: NormalizedMultipleBill[][] = [];
    const windowMs = windowDays * 24 * 60 * 60 * 1000;

    for (const group of groups.values()) {
        if (group.length < 2) continue;

        // Group by vendor first if we want same-vendor clusters
        const vendorGroups = new Map<string, NormalizedMultipleBill[]>();
        for (const bill of group) {
            const vendor = bill.vendorId || 'UNKNOWN';
            if (!vendorGroups.has(vendor)) vendorGroups.set(vendor, []);
            vendorGroups.get(vendor)!.push(bill);
        }

        for (const vendorGroup of vendorGroups.values()) {
            if (vendorGroup.length < 2) continue;

            const sorted = [...vendorGroup].sort((a, b) => a.date.getTime() - b.date.getTime());
            let currentCluster: NormalizedMultipleBill[] = [sorted[0]];

            for (let i = 1; i < sorted.length; i++) {
                const diff = sorted[i].date.getTime() - currentCluster[currentCluster.length - 1].date.getTime();
                if (diff <= windowMs) {
                    currentCluster.push(sorted[i]);
                } else {
                    if (currentCluster.length >= 2) clusters.push(currentCluster);
                    currentCluster = [sorted[i]];
                }
            }
            if (currentCluster.length >= 2) clusters.push(currentCluster);
        }
    }

    return clusters;
}
