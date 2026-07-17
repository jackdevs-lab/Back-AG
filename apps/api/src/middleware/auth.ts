import { createClerkClient, verifyToken } from '@clerk/backend';
import { Request, Response, NextFunction } from 'express';
import { AppError } from './error-handler';
import { prisma } from '@qb-health/financial-model';
import { logger } from '@qb-health/utils';

// Initialize Clerk Backend Client
export const clerkClient = createClerkClient({ 
    secretKey: process.env.CLERK_SECRET_KEY 
});

export interface AuthRequest extends Request {
    tenantId?: string;
    userId?: string;
}

/**
 * Clerk Authentication Middleware with JIT Provisioning
 * 
 * Verifies the Clerk JWT and automatically ensures a corresponding 
 * Tenant record exists in our database. This removes the immediate 
 * necessity for webhooks.
 */
export const authMiddleware = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        let authHeader = req.headers.authorization;
        let tenantIdHeader = req.headers['x-tenant-id'] as string;

        // Fallback to query params for SSE endpoints
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

        try {
            // Verify the token using Clerk's secret key
            const decoded = await verifyToken(token, {
                secretKey: process.env.CLERK_SECRET_KEY
            });
            
            const userId = decoded.sub;
            const orgId = decoded.org_id; 

            // Priority: Organization context takes precedence
            const derivedTenantId = (orgId as string) || userId;

            // Security check: Ensure requested tenant matches token context
            if (tenantIdHeader && derivedTenantId !== tenantIdHeader) {
                return next(new AppError('Tenant context mismatch', 403));
            }

            // Just-In-Time (JIT) Provisioning
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

                    tenant = await prisma!.tenant.create({
                        data: {
                            id: derivedTenantId,
                            name,
                            email
                        }
                    });
                    logger.info(`JIT: Successfully provisioned tenant ${derivedTenantId}`);
                } catch (provisionError: any) {
                    logger.error('JIT Provisioning failed:', {
                        error: provisionError.message || provisionError,
                        code: provisionError.code,
                        tenantId: derivedTenantId
                    });
                    // If creation fails (e.g. race condition), try one last fetch
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