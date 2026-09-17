import pino from 'pino';

// 7.3 H6: Ensure pino-pretty only mounts inside interactive dev TTY terminals
const transport = process.env.NODE_ENV === 'development' && process.stdout.isTTY
    ? pino.transport({
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
        }
    })
    : undefined;

export const baseLogger = pino({
    level: process.env.LOG_LEVEL || 'info',
    base: {
        service: 'qb-health-monitor',
        env: process.env.NODE_ENV
    }
}, transport);

export interface LogContext {
    tenantId?: string;
    realmId?: string;
    jobId?: string;
    userId?: string;
    correlationId?: string;
    [key: string]: any;
}

// Standardized logging wrapper to enforce object-first or string-first consistency
export class Logger {
    private childLogger: pino.Logger;

    constructor(bindings: Record<string, any> = {}) {
        this.childLogger = baseLogger.child(bindings);
    }

    info(msg: string, obj?: Record<string, any>): void {
        if (obj) {
            this.childLogger.info(obj, msg);
        } else {
            this.childLogger.info(msg);
        }
    }

    error(msg: string, err?: Error | unknown, obj?: Record<string, any>): void {
        const errorData = err instanceof Error
            ? {
                message: err.message,
                stack: err.stack,
                name: err.name,
                ...(err as any).code && { code: (err as any).code },
                ...(err as any).status && { status: (err as any).status },
                ...(err as any).response?.data && { responseData: (err as any).response.data }
            }
            : err;

        const payload = { ...obj, ...(err instanceof Error ? { err: errorData } : { error: errorData }) };
        this.childLogger.error(payload, msg);
    }

    warn(msg: string, obj?: Record<string, any>): void {
        if (obj) {
            this.childLogger.warn(obj, msg);
        } else {
            this.childLogger.warn(msg);
        }
    }

    debug(msg: string, obj?: Record<string, any>): void {
        if (obj) {
            this.childLogger.debug(obj, msg);
        } else {
            this.childLogger.debug(msg);
        }
    }

    fatal(msg: string, err?: Error | unknown, obj?: Record<string, any>): void {
        const errorData = err instanceof Error
            ? { message: err.message, stack: err.stack, name: err.name }
            : err;

        const payload = { ...obj, ...(err instanceof Error ? { err: errorData } : { error: errorData }) };
        this.childLogger.fatal(payload, msg);
    }

    child(context: LogContext): Logger {
        return new Logger({ ...this.childLogger.bindings(), ...context });
    }
}

export const createLogger = (context?: LogContext) => new Logger(context);
export const logger = new Logger();