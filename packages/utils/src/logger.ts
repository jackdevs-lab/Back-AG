import pino from 'pino';

const pinoLogger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development' ? {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
        }
    } : undefined,
    base: {
        service: 'qb-health-monitor',
        env: process.env.NODE_ENV
    }
});

export interface LogContext {
    tenantId?: string;
    realmId?: string;
    jobId?: string;
    userId?: string;
    [key: string]: any;
}

export class Logger {
    private baseLogger: pino.Logger;

    constructor(context?: LogContext) {
        this.baseLogger = context ? pinoLogger.child(context) : pinoLogger;
    }

    info(message: string, data?: any) {
        this.baseLogger.info(data, message);
    }

    error(message: string, error?: any, data?: any) {
        const errorData = error instanceof Error 
            ? { 
                message: error.message, 
                stack: error.stack,
                name: error.name,
                ...(error as any).code && { code: (error as any).code },
                ...(error as any).status && { status: (error as any).status },
                ...(error as any).response?.data && { responseData: (error as any).response.data }
              } 
            : error;

        this.baseLogger.error({
            error: errorData,
            ...data
        }, message);
    }

    warn(message: string, data?: any) {
        this.baseLogger.warn(data, message);
    }

    debug(message: string, data?: any) {
        this.baseLogger.debug(data, message);
    }

    fatal(message: string, error?: any, data?: any) {
        const errorData = error instanceof Error 
            ? { message: error.message, stack: error.stack, name: error.name } 
            : error;

        this.baseLogger.fatal({
            error: errorData,
            ...data
        }, message);
    }

    child(context: LogContext): Logger {
        return new Logger({ ...this.baseLogger.bindings(), ...context });
    }
}

export const createLogger = (context?: LogContext) => new Logger(context);
export const logger = new Logger();