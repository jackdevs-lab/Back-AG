import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '@qb-health/financial-model';
import { AppError } from '../middleware/error-handler';
import PDFDocument from 'pdfkit';
import { parseMarkdownFindings, DiagnosticFinding } from '../utils/report-parser';
import { AuthRequest } from '../middleware/auth'; // adjust path as needed

const router: Router = Router();

// Secure endpoint: uses authenticated tenant, no client-supplied connectionId
router.get('/pdf', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            throw new AppError('Authentication required', 401);
        }

        // Find the most recent active connection for this tenant
        const connection = await prisma.qbConnection.findFirst({
            where: {
                tenantId,
                subscriptionStatus: 'ACTIVE'
            },
            orderBy: { lastSyncAt: 'desc' } // or createdAt if lastSyncAt not present
        });

        if (!connection) {
            throw new AppError('No active connection found for this account', 404);
        }

        const connectionId = connection.id;

        const diagnosticRun = await prisma.diagnosticRun.findFirst({
            where: { connectionId },
            orderBy: { runAt: 'desc' }
        });

        if (!diagnosticRun) {
            throw new AppError('No diagnostic runs found for this connection', 404);
        }

        // Fetch all issues and checks
        const issues = await prisma.issue.findMany({
            where: { connectionId }
        });

        const checks = await prisma.diagnosticCheck.findMany({
            where: { runId: diagnosticRun.id }
        });

        // Group issues by ruleId to avoid duplication; we'll render one report per rule
        const uniqueIssuesMap = new Map<string, typeof issues[0]>();
        for (const issue of issues) {
            if (!uniqueIssuesMap.has(issue.ruleId)) {
                uniqueIssuesMap.set(issue.ruleId, issue);
            }
        }
        const uniqueIssues = Array.from(uniqueIssuesMap.values());

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="qb-health-report-${connectionId.slice(0, 8)}.pdf"`
        );

        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        doc.pipe(res);

        // Header
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

        if (uniqueIssues.length === 0) {
            doc.fontSize(10).fillColor('#374151').text('No issues detected. Your financial hygiene looks great!');
        } else {
            uniqueIssues.forEach((issue: any, index: number) => {
                if (doc.y > 700) doc.addPage();

                // Title
                doc.fontSize(11).fillColor('#1f2937').text(`${index + 1}. [${issue.severity}] ${issue.ruleName}`);

                // Parse the message
                const parsed = parseMarkdownFindings(issue.message);

                if (parsed.findings.length > 0) {
                    parsed.findings.forEach((finding: DiagnosticFinding) => {
                        if (doc.y > 700) doc.addPage();

                        // Type
                        doc.fontSize(10).fillColor('#374151').text(finding.type);

                        // Description
                        doc.fontSize(9.5).fillColor('#4b5563').text(finding.description);

                        // Render all URLs as clickable links
                        if (finding.urls.length > 0) {
                            doc.moveDown(0.3);
                            finding.urls.forEach((url, urlIdx) => {
                                doc.fontSize(9)
                                    .fillColor('#2563eb')
                                    .text(`Open QuickBooks Link ${urlIdx + 1}`, {
                                        link: url,
                                        underline: true,
                                    });
                                doc.moveDown(0.2);
                            });
                        }
                        doc.moveDown(0.5);
                    });
                } else {
                    // Fallback: print raw message
                    doc.fontSize(9.5).fillColor('#4b5563').text(`Summary: ${issue.message}`);
                }
                doc.moveDown(1);
            });
        }

        doc.end();

    } catch (error) {
        next(error);
    }
});

export default router;