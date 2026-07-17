export interface LogContext {
    tenantId?: string;
    realmId?: string;
    jobId?: string;
    userId?: string;
    [key: string]: any;
}
export declare class Logger {
    private baseLogger;
    constructor(context?: LogContext);
    info(message: string, data?: any): void;
    error(message: string, error?: Error, data?: any): void;
    warn(message: string, data?: any): void;
    debug(message: string, data?: any): void;
    child(context: LogContext): Logger;
}
export declare const createLogger: (context?: LogContext) => Logger;
export declare const logger: Logger;
