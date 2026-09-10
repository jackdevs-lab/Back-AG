import { createClerkClient, verifyToken } from '@clerk/backend';
import { Request, Response, NextFunction } from 'express';
import { AppError } from './error-handler';
import { prisma } from '@qb-health/financial-model';
import { logger } from '@qb-health/utils';

const instanceId = process.env.HOSTNAME || process.env.RAILWAY_SERVICE_NAME || 'unknown-instance';

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

    const authHeader = req.headers.authorization;
    const queryToken = req.query.token as string | undefined;
    const tenantIdHeader = req.headers['x-tenant-id'] as string;

    // Fallback to query param token for EventSource / SSE connections
    const token = authHeader?.startsWith('Bearer ')
        ? authHeader.split(' ')[1]
        : queryToken;

    if (!token || token === 'null' || token === 'undefined') {
        console.warn(`[AUTH 401] Instance: ${instanceId}, Reason: MISSING_TOKEN, Path: ${req.path}, Tenant: ${tenantIdHeader}`);
        return next(new AppError('Authorization token required', 401));
    }

    // Phase 1: Token Verification
    let decoded;
    try {
        decoded = await verifyToken(token, {
            secretKey: process.env.CLERK_SECRET_KEY
        });
    } catch (err: any) {
        const reason = err?.code || err?.message || 'INVALID_TOKEN';
        console.warn(`[AUTH 401] Instance: ${instanceId}, Reason: ${reason}, Path: ${req.path}, Tenant: ${tenantIdHeader}`);
        return next(new AppError('Invalid or expired Clerk token', 401));
    }

    const userId = decoded.sub;
    const orgId = decoded.org_id;
    const derivedTenantId = (orgId as string) || userId;

    // Strict Tenant Context Mismatch check
    if (tenantIdHeader && derivedTenantId !== tenantIdHeader) {
        return next(new AppError('Tenant context mismatch', 403));
    }

    // Phase 2: User/Org Metadata Fetching
    let name = 'New Workspace';
    let email = `tenant_${derivedTenantId}@clerk.system`;

    if (orgId) {
        try {
            const org = await clerkClient.organizations.getOrganization({
                organizationId: orgId as string
            });
            name = org.name;
        } catch (e) {
            // Fallback gracefully
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

    // Phase 3: Tenant Provisioning & Synchronization
    try {
        const allowedReviewerEmail = process.env.AUDITOR_BYPASS_EMAIL || 'intuit-review@auditorgen.com';
        const isReviewer = email.toLowerCase() === allowedReviewerEmail.toLowerCase();

        // 1. Check if tenant exists by ID
        let tenant = await prisma.tenant.findUnique({
            where: { id: derivedTenantId }
        });

        if (!tenant) {
            // 2. Check if a record already claims this email to avoid P2002 collision
            const existingEmailTenant = await prisma.tenant.findFirst({
                where: { email }
            });

            const safeEmail = existingEmailTenant
                ? `${derivedTenantId}_${email}` // Disambiguate email if shared across orgs/users
                : email;

            tenant = await prisma.tenant.create({
                data: {
                    id: derivedTenantId,
                    name,
                    email: safeEmail,
                    isBypassed: isReviewer
                }
            });
        } else if (tenant.email !== email && !tenant.email.includes('_')) {
            // Update email on existing tenant if changed
            tenant = await prisma.tenant.update({
                where: { id: derivedTenantId },
                data: { email }
            });
        }

        req.tenantId = derivedTenantId;
        req.userId = userId;
        next();
    } catch (dbError: any) {
        logger.error(`[AUTH 500] Database tenant sync failed: ${dbError.message}`, { error: dbError });
        return next(new AppError('Failed to initialize workspace context', 500));
    }
};