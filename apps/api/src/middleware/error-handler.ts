import { Request, Response, NextFunction } from 'express';
import { logger } from '@qb-health/utils';

export class AppError extends Error {
    constructor(
        public message: string,
        public statusCode: number = 500,
        public isOperational: boolean = true
    ) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);
        Error.captureStackTrace(this);
    }
}

export const errorHandler = (
    err: Error | AppError,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const { method, url, ip, headers } = req;

    // Safely extract realmId using optional chaining to prevent secondary crashes
    const safeRealmId = req.query?.realmId || (req.body && typeof req.body === 'object' ? req.body.realmId : undefined);

    logger.error(`Unhandled error: ${method} ${url}`, err, {
        ip,
        userAgent: headers['user-agent'],
        tenantId: headers['x-tenant-id'],
        realmId: safeRealmId
    });

    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            success: false,
            error: err.message
        });
    }

    // Fallback for unhandled server errors - hide internal file paths from auditors
    return res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
};