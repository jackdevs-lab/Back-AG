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
    if (req.path === '/launch' || req.baseUrl?.endsWith('/launch')) {
        return next();
    }
    try {
        let authHeader = req.headers.authorization;
        let tenantIdHeader = req.headers['x-tenant-id'] as string;

        if (!authHeader && req.query.token) {
            authHeader = `Bearer ${req.query.token}`;
        }
        if (!tenantIdHeader && req.query.tenantId) {
            tenantIdHeader = req.query.tenantId as string;
        }

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return next(new AppError('Authorization header required', 401));
        }

        const token = authHeader.split(' ')[1];

        if (!token || token === 'null' || token === 'undefined') {
            return next(new AppError('Invalid token format', 401));
        }

        try {
            const decoded = await verifyToken(token, {
                secretKey: process.env.CLERK_SECRET_KEY
            });

            const userId = decoded.sub;
            const orgId = decoded.org_id;

            const derivedTenantId = (orgId as string) || userId;

            if (tenantIdHeader && derivedTenantId !== tenantIdHeader) {
                return next(new AppError('Tenant context mismatch', 403));
            }
            let tenant = await prisma!.tenant.findUnique({
                where: { id: derivedTenantId }
            });

            if (!tenant) {
                logger.info(`JIT: Tenant ${derivedTenantId} not found in DB. Provisioning...`);
                try {
                    let name = 'New Workspace';
                    let email = `tenant_${derivedTenantId}@clerk.system`;

                    if (orgId) {
                        const org = await clerkClient.organizations.getOrganization({
                            organizationId: orgId as string
                        });
                        name = org.name;
                    } else {
                        const user = await clerkClient.users.getUser(userId);
                        name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'New User';
                        email = user.emailAddresses[0]?.emailAddress || email;
                    }

                    const isReviewer = email === 'intuit-review@auditorgen.com';

                    tenant = await prisma!.tenant.create({
                        data: {
                            id: derivedTenantId,
                            name,
                            email,
                            isBypassed: isReviewer
                        }
                    });
                    logger.info(`JIT: Successfully provisioned tenant ${derivedTenantId}`);
                } catch (provisionError: any) {
                    logger.error('JIT Provisioning failed:', {
                        error: provisionError.message || provisionError,
                        code: provisionError.code,
                        tenantId: derivedTenantId
                    });
                    tenant = await prisma!.tenant.findUnique({ where: { id: derivedTenantId } });
                    if (!tenant) return next(new AppError('Failed to initialize workspace context', 500));
                }
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