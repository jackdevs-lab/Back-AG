import { createClerkClient, verifyToken } from '@clerk/backend';
import { Request, Response, NextFunction } from 'express';
import { AppError } from './error-handler';
import { prisma } from '@qb-health/financial-model';
import { logger } from '@qb-health/utils';

export const clerkClient = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY
});

export interface AuthRequest extends Request {
    tenantId?: string;
    userId?: string;
}

export const authMiddleware = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
) => {
    // Bypass authentication for launch/health check routes
    if (req.path === '/launch' || req.baseUrl?.endsWith('/launch')) {
        return next();
    }

    try {
        const authHeader = req.headers.authorization;
        const queryToken = req.query.token as string | undefined;
        const tenantIdHeader = req.headers['x-tenant-id'] as string;

        // Fallback to query param token for EventSource / SSE connections
        const token = authHeader?.startsWith('Bearer ')
            ? authHeader.split(' ')[1]
            : queryToken;

        if (!token || token === 'null' || token === 'undefined') {
            return next(new AppError('Authorization token required', 401));
        }

        try {
            const decoded = await verifyToken(token, {
                secretKey: process.env.CLERK_SECRET_KEY
            });

            const userId = decoded.sub;
            const orgId = decoded.org_id;

            const derivedTenantId = (orgId as string) || userId;

            // Strict Tenant Context Mismatch check
            if (tenantIdHeader && derivedTenantId !== tenantIdHeader) {
                return next(new AppError('Tenant context mismatch', 403));
            }

            // Fetch user/org metadata from Clerk safely for JIT setup if needed
            let name = 'New Workspace';
            let email = `tenant_${derivedTenantId}@clerk.system`;

            if (orgId) {
                try {
                    const org = await clerkClient.organizations.getOrganization({
                        organizationId: orgId as string
                    });
                    name = org.name;
                } catch (e) {
                    // Fallback gracefully if Clerk API blips
                }
            } else {
                try {
                    const user = await clerkClient.users.getUser(userId);
                    name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'New User';
                    email = user.emailAddresses[0]?.emailAddress || email;
                } catch (e) {
                    // Fallback gracefully
                }
            }

            const allowedReviewerEmail = process.env.AUDITOR_BYPASS_EMAIL || 'intuit-review@auditorgen.com';
            const isReviewer = email.toLowerCase() === allowedReviewerEmail.toLowerCase();

            const tenant = await prisma!.tenant.upsert({
                where: { id: derivedTenantId },
                update: {},
                create: {
                    id: derivedTenantId,
                    name,
                    email,
                    isBypassed: isReviewer
                }
            });

            if (!tenant) {
                return next(new AppError('Failed to initialize workspace context', 500));
            }

            req.tenantId = derivedTenantId;
            req.userId = userId;
            next();
        } catch (err) {
            console.error('Clerk Token Verification Failed:', err);
            return next(new AppError('Invalid or expired Clerk token', 401));
        }
    } catch (error) {
        next(error);
    }
};