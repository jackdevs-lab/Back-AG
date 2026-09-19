import rateLimit from 'express-rate-limit';
import { AuthRequest } from './auth';

/**
 * Prefer tenantId (set by authMiddleware) so multiple users behind the same
 * NAT don't share a bucket. Fall back to IP for unauthenticated routes.
 */
function keyByTenantOrIp(req: any): string {
    const auth = req as AuthRequest;
    return auth.tenantId ?? (auth as any).userId ?? req.ip ?? 'unknown';
}

/**
 * Authenticated API. Applied AFTER authMiddleware so tenantId is populated.
 * Budget: 1000 / 15 min ≈ 66 req/min per tenant — comfortable for a dashboard
 * that fires ~30 requests on load plus a burst of drilldown clicks.
 */
export const authenticatedLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyByTenantOrIp,
    message: { error: 'Too many requests. Please wait a moment and try again.' },
});

/**
 * Public auth endpoints (sign-in, OAuth URL mint, callback).
 * Tight, IP-keyed — these are the primary target for abuse and run before
 * the user is known.
 */
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Try again later.' },
});

/**
 * Webhook receivers. Providers retry aggressively on non-2xx, so the budget
 * needs to be generous. Keyed by the provider's signature header when present
 * so a legit flood from Paystack doesn't collide with a flood from QBO.
 */
export const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const sig =
            req.headers['x-paystack-signature'] ??
            req.headers['intuit-signature'];
        if (typeof sig === 'string' && sig.length > 0) return sig.slice(0, 48);
        return req.ip ?? 'unknown';
    },
    message: { error: 'Webhook rate limit exceeded.' },
});