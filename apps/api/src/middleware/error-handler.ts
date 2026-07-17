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
    
    logger.error(`Unhandled error: ${method} ${url}`, err, {
        ip,
        userAgent: headers['user-agent'],
        tenantId: headers['x-tenant-id'],
        realmId: req.query.realmId || req.body.realmId
    });

    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            success: false,
            error: err.message
        });
    }

    return res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === 'development' || !process.env.NODE_ENV ? err.message : 'Internal server error',
        stack: process.env.NODE_ENV === 'development' || !process.env.NODE_ENV ? err.stack : undefined
    });
};