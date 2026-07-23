import 'dotenv/config';
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { logger } from '@qb-health/utils';
import { prisma } from '@qb-health/financial-model';
import routes from './routes';
import { errorHandler } from './middleware/error-handler';
import { requestLogger } from './middleware/request-logger';

const app: Express = express();
const PORT = process.env.PORT || 3001;
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP'
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
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