import { Request, Response, NextFunction } from 'express';
import { logger } from '@qb-health/utils';

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const { method, url, ip } = req;

    // Log request start
    logger.info(`Incoming ${method} ${url}`, {
        ip,
        userAgent: req.get('user-agent'),
        tenantId: req.headers['x-tenant-id']
    });

    // Listen for completion
    res.on('finish', () => {
        const duration = Date.now() - start;
        const { statusCode } = res;
        
        const logData = {
            method,
            url,
            statusCode,
            duration: `${duration}ms`,
            contentLength: res.get('content-length')
        };

        if (statusCode >= 400) {
            logger.warn(`Request failed: ${method} ${url} - ${statusCode}`, logData);
        } else {
            logger.info(`Request completed: ${method} ${url} - ${statusCode}`, logData);
        }
    });

    next();
};
