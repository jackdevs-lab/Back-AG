import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from '@qb-health/financial-model';
import { AppError } from '../middleware/error-handler';

const router: Router = Router();

router.post('/login', async (req: Request, res: Response, next) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            throw new AppError('Email and password are required', 400);
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Changed: use findFirst instead of findUnique
        let user = await prisma.user.findFirst({
            where: { email: normalizedEmail },
            include: { tenant: true }
        });

        if (!user) {
            throw new AppError('Invalid credentials', 401);
        }

        // Safety: prevent login if same email exists in multiple tenants
        const duplicateCount = await prisma.user.count({
            where: { email: normalizedEmail }
        });

        if (duplicateCount > 1) {
            throw new AppError(
                'Multiple accounts found for this email. Please specify your organization.',
                400
            );
            // Later: you can return list of tenants or redirect to tenant picker
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            throw new AppError('Invalid credentials', 401);
        }

        const token = jwt.sign(
            {
                userId: user.id,
                tenantId: user.tenantId,
                email: user.email
            },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            data: {
                token,
                tenantId: user.tenantId,
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.tenant?.name || 'User'   // safe access
                }
            }
        });
    } catch (error) {
        next(error);
    }
});
export default router;
