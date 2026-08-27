import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '@qb-health/financial-model';
import { AppError } from '../middleware/error-handler';
import PDFDocument from 'pdfkit';

const router: Router = Router();

router.get('/pdf/:connectionId', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { connectionId } = req.params;

        if (!connectionId) {
            throw new AppError('Connection ID is required', 400);
        }

        // Fetch connection using QbConnection model and verify active subscription state
        const connection = await prisma.qbConnection.findUnique({
            where: { id: connectionId }
        });

        if (!connection) {
            throw new AppError('Connection not found', 404);
        }

        if (connection.subscriptionStatus !== 'ACTIVE') {
            throw new AppError('Active subscription required to download audit reports', 402);
        }

        // Fetch latest diagnostic run details ordered by runAt date
        const diagnosticRun = await prisma.diagnosticRun.findFirst({
            where: { connectionId },
            orderBy: { runAt: 'desc' }
        });

        if (!diagnosticRun) {
            throw new AppError('No diagnostic runs found for this connection', 404);
        }

        // Fetch associated issues using connectionId and checks using runId based on your schema structure
        const issues = await prisma.issue.findMany({
            where: { connectionId }
        });

        const checks = await prisma.diagnosticCheck.findMany({
            where: { runId: diagnosticRun.id }
        });

        // Set response headers for direct file download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="qb-health-report-${connectionId.slice(0, 8)}.pdf"`
        );

        // Initialize PDFKit document with a clean layout margin
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        doc.pipe(res);

        // --- PDF Design Layout ---
        doc.fontSize(20).fillColor('#111827').text('QuickBooks Health Audit Report', { align: 'left' });
        doc.fontSize(10.5).fillColor('#6b7280').text(`Generated On: ${new Date().toISOString().split('T')[0]}`, { align: 'left' });
        doc.moveDown(1.5);

        // Executive Summary Box
        doc.rect(50, doc.y, 495, 60).fillAndStroke('#f3f4f6', '#e5e7eb');
        doc.fillColor('#1f2937').fontSize(12).text(`Health Score: ${diagnosticRun.healthScore ?? 'N/A'} / 100`, 65, doc.y - 45);
        doc.fontSize(10).fillColor('#4b5563').text(`Total Issues Detected: ${issues.length} | Checks Performed: ${checks.length}`, 65, doc.y + 5);
        doc.moveDown(2);

        // Detailed Findings Section
        doc.fontSize(14).fillColor('#111827').text('Detected Rule Violations', { underline: true });
        doc.moveDown(0.5);

        if (issues.length === 0) {
            doc.fontSize(10).fillColor('#374151').text('No issues detected. Your financial hygiene looks great!');
        } else {
            issues.forEach((issue: any, index: number) => {
                if (doc.y > 700) doc.addPage(); // Prevent page overflow clipping

                doc.fontSize(11).fillColor('#1f2937').text(`${index + 1}. [${issue.severity}] ${issue.ruleName}`);
                doc.fontSize(9.5).fillColor('#4b5563').text(`Summary: ${issue.message}`);
                doc.moveDown(0.75);
            });
        }

        // Finalize document stream
        doc.end();

    } catch (error) {
        next(error);
    }
});

export default router;