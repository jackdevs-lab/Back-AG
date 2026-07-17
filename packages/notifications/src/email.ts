// packages/notifications/src/email.ts
import nodemailer from 'nodemailer';
import { prisma } from '@qb-health/financial-model';
import { logger } from '@qb-health/utils';

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

export interface AlertData {
    score: number;
    issueCount: number;
    criticalCount: number;
}

export async function sendAlert(tenantId: string, data: AlertData): Promise<void> {
    try {
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            include: { users: true }
        });

        if (!tenant) {
            logger.warn('Tenant not found for alert', { tenantId });
            return;
        }

        const subject = `  QuickBooks Health Alert - Score: ${data.score}/100`;

        const html = `
      <h2>Financial Health Alert</h2>
      <p>Your QuickBooks health score has dropped to <strong>${data.score}/100</strong>.</p>
      
      <h3>Summary</h3>
      <ul>
        <li>Total Issues: ${data.issueCount}</li>
        <li>Critical Issues: ${data.criticalCount}</li>
      </ul>
      
      <p>Please log in to review and resolve these issues.</p>
      
      <a href="${process.env.FRONTEND_URL}/dashboard" 
         style="background-color: #4F46E5; color: white; padding: 10px 20px; 
                text-decoration: none; border-radius: 5px; display: inline-block;">
        View Dashboard
      </a>
    `;

        const emails = tenant.users.map(u => u.email);

        await transporter.sendMail({
            from: process.env.FROM_EMAIL,
            to: emails.join(','),
            subject,
            html
        });

        logger.info('Alert email sent', { tenantId, recipientCount: emails.length });
    } catch (error) {
        logger.error('Failed to send alert email', error as Error, { tenantId });
    }
}