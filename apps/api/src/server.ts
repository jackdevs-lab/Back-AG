import 'dotenv/config';
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import reportsRouter from './routes/reports';
import { logger } from '@qb-health/utils';
import { prisma } from '@qb-health/financial-model';
import routes from './routes';
import { errorHandler } from './middleware/error-handler';
import { requestLogger } from './middleware/request-logger';

const app: Express = express();
const PORT = process.env.PORT || 3001;
app.set('trust proxy', 1);
app.use(helmet());
const ALLOWED_ORIGINS = (process.env.FRONTEND_URLS ?? process.env.FRONTEND_URL ?? 'http://localhost:3000')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        logger.warn('CORS blocked origin', { origin, allowed: ALLOWED_ORIGINS });
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id'],
    exposedHeaders: ['x-tenant-id'],
    optionsSuccessStatus: 200,
}));


// Body parsing
app.use((req, res, next) => {
    // Skip the global JSON parser for webhook routes so express.raw() can handle them later
    if (req.originalUrl.startsWith('/api/webhooks')) {
        next();
    } else {
        express.json({ limit: '10mb' })(req, res, next);
    }
});
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(requestLogger);

// Health check
app.get('/health', async (req: Request, res: Response) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    } catch (error) {
        res.status(503).json({ status: 'unhealthy', error: 'Database connection failed' });
    }
});

// Routes
app.use('/api', routes);
app.use('/api/reports', reportsRouter);
// Error handling
app.use(errorHandler);

// 404 handler
app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, () => {
    logger.info(`API server running on port ${PORT}`);
});

export default app;