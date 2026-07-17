import { NormalizedNegativeBalance } from '../normalize/negative-ap-balance';

export function detectNegativeBalances(balances: NormalizedNegativeBalance[], threshold: number) {
    const sanitizedThreshold = -Math.abs(threshold);
    return balances.filter(b => b.balance.toNumber() < sanitizedThreshold);
}
