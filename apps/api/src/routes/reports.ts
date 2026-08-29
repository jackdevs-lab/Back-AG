import { Router, Response, NextFunction } from 'express';
import { prisma } from '@qb-health/financial-model';
import { AppError } from '../middleware/error-handler';
import PDFDocument from 'pdfkit';
import { parseMarkdownFindings, DiagnosticFinding } from '../utils/report-parser';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router: Router = Router();
router.use(authMiddleware);

const COLORS = {
    ink: '#1a1a1a',
    dark: '#333333',
    muted: '#666666',
    subtle: '#999999',
    border: '#cccccc',
    primary: '#1a4d8f',
    success: '#2e7d32',
    warning: '#b26a00',
    danger: '#b71c1c',
    lightBg: '#f7f7f7',
    white: '#ffffff',
};

const PAGE = {
    width: 595.28,
    height: 841.89,
    margin: 64,
    contentWidth: 595.28 - 128,
    bottom: 800,
};

function getSeverityColor(severity: string): string {
    const s = severity.toUpperCase();
    if (s.includes('CRITICAL') || s.includes('ERROR')) return COLORS.danger;
    if (s.includes('WARNING') || s.includes('WARN')) return COLORS.warning;
    if (s.includes('INFO')) return COLORS.primary;
    return COLORS.muted;
}

function drawFooter(doc: PDFKit.PDFDocument, pageNumber: number) {
    const oldX = doc.x;
    const oldY = doc.y;

    const originalBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc.save();
    doc
        .strokeColor(COLORS.border)
        .lineWidth(0.5)
        .moveTo(PAGE.margin, 790)
        .lineTo(PAGE.width - PAGE.margin, 790)
        .stroke();

    doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(COLORS.subtle)
        .text('AUDIT GEN  •  QUICKBOOKS HEALTH DIAGNOSTICS', PAGE.margin, 800, {
            width: 350,
            lineBreak: false
        });

    doc
        .fontSize(7.5)
        .text(`Page ${pageNumber}`, PAGE.width - PAGE.margin - 80, 800, {
            width: 80,
            align: 'right',
            lineBreak: false
        });

    doc.restore();

    doc.page.margins.bottom = originalBottomMargin;
    doc.x = oldX;
    doc.y = oldY;
}

function ensureSpace(doc: PDFKit.PDFDocument, requiredHeight: number) {
    if (doc.y + requiredHeight > PAGE.bottom) {
        doc.addPage();
    }
}

function drawCoverPage(
    doc: PDFKit.PDFDocument,
    diagnosticRun: any,
    issues: any[],
    checks: any[],
    uniqueIssues: any[]
) {
    // Brand
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.primary).text('AUDIT GEN', PAGE.margin, doc.y);
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.subtle).text('QuickBooks Health Diagnostics', PAGE.margin, doc.y);
    doc.moveDown(3);

    // Title
    doc.font('Helvetica-Bold').fontSize(24).fillColor(COLORS.ink).text('Financial Health Audit Report', PAGE.margin, doc.y);
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(11).fillColor(COLORS.muted).text(`Generated ${new Date().toISOString().split('T')[0]}`, PAGE.margin, doc.y);
    doc.moveDown(2);

    // Simple metrics table
    const tableTop = doc.y;
    const colWidths = [PAGE.contentWidth * 0.4, PAGE.contentWidth * 0.3, PAGE.contentWidth * 0.3];
    const rowHeight = 30;

    // Header row
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.white);
    doc.rect(PAGE.margin, tableTop, PAGE.contentWidth, rowHeight).fill(COLORS.primary);
    doc.fillColor(COLORS.white)
        .text('Metric', PAGE.margin + 8, tableTop + 10, { width: colWidths[0] - 16 })
        .text('Value', PAGE.margin + colWidths[0] + 8, tableTop + 10, { width: colWidths[1] - 16 })
        .text('Details', PAGE.margin + colWidths[0] + colWidths[1] + 8, tableTop + 10, { width: colWidths[2] - 16 });

    const rows = [
        ['Health Score', diagnosticRun.healthScore ?? 'N/A', ''],
        ['Issues Detected', issues.length, ''],
        ['Checks Performed', checks.length, ''],
        ['Rules Flagged', uniqueIssues.length, ''],
    ];

    let y = tableTop + rowHeight;
    rows.forEach((row, idx) => {
        if (idx % 2 === 0) {
            doc.rect(PAGE.margin, y, PAGE.contentWidth, rowHeight).fill(COLORS.lightBg);
        }
        doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink);
        doc.text(row[0] as string, PAGE.margin + 8, y + 10, { width: colWidths[0] - 16 });
        doc.text(String(row[1]), PAGE.margin + colWidths[0] + 8, y + 10, { width: colWidths[1] - 16 });
        doc.text(row[2] as string, PAGE.margin + colWidths[0] + colWidths[1] + 8, y + 10, { width: colWidths[2] - 16 });
        y += rowHeight;
    });

    // Reset cursor position to left margin and place it below the table
    doc.x = PAGE.margin;
    doc.y = y + 25;

    // Executive summary
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.ink).text('Executive Summary', PAGE.margin, doc.y);
    doc.moveDown(0.4);

    const score = diagnosticRun.healthScore;
    let assessment = 'The diagnostic identified areas requiring review within the connected QuickBooks data.';
    if (score !== null && score !== undefined) {
        if (score >= 90) assessment = 'The account is in strong overall condition, with a small number of issues identified for review.';
        else if (score >= 75) assessment = 'The account is generally healthy, although several items should be reviewed to maintain clean financial records.';
        else if (score >= 60) assessment = 'The diagnostic identified several areas that require attention and follow-up.';
        else assessment = 'The diagnostic identified significant issues that should be investigated and resolved as a priority.';
    }

    doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted).text(assessment, PAGE.margin, doc.y, {
        width: PAGE.contentWidth,
        lineGap: 4
    });
    doc.moveDown(2);

    doc.font('Helvetica').fontSize(8).fillColor(COLORS.subtle).text(
        'This report is generated from the latest completed diagnostic run and is intended to assist with accounting review and remediation.',
        PAGE.margin,
        doc.y,
        {
            width: PAGE.contentWidth,
            lineGap: 3,
        }
    );
}

function drawFinding(doc: PDFKit.PDFDocument, issue: any, index: number) {
    ensureSpace(doc, 60);

    const startY = doc.y;

    // Rule name (Left aligned)
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.ink)
        .text(`${index + 1}. ${issue.ruleName}`, PAGE.margin, startY, { width: PAGE.contentWidth - 80 });
    const nameEndY = doc.y;

    // Severity (Right aligned on same line)
    doc.font('Helvetica-Bold').fontSize(9).fillColor(getSeverityColor(issue.severity))
        .text(issue.severity.toUpperCase(), PAGE.margin + PAGE.contentWidth - 70, startY, { width: 70, align: 'right' });
    const severityEndY = doc.y;

    // FIX: Force cursor back to left margin and below the header height
    doc.x = PAGE.margin;
    doc.y = Math.max(nameEndY, severityEndY);
    doc.moveDown(0.5);

    const parsed = parseMarkdownFindings(issue.message);
    if (parsed.findings.length > 0) {
        parsed.findings.forEach((finding: DiagnosticFinding) => {
            // Type
            if (finding.type) {
                ensureSpace(doc, 20);
                doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.dark)
                    .text(finding.type, PAGE.margin, doc.y, { width: PAGE.contentWidth });
                doc.moveDown(0.2);
            }

            // Description
            if (finding.description) {
                ensureSpace(doc, 30);
                doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
                    .text(finding.description, PAGE.margin, doc.y, { width: PAGE.contentWidth, lineGap: 3 });
                doc.moveDown(0.3);
            }

            // Links
            if (finding.urls.length > 0) {
                ensureSpace(doc, 25);
                finding.urls.forEach((url, urlIdx) => {
                    ensureSpace(doc, 20);
                    const linkLabel = finding.urls.length === 1 ? 'Open in QuickBooks' : `Open QuickBooks Link ${urlIdx + 1}`;
                    doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.primary)
                        .text(linkLabel, PAGE.margin, doc.y, {
                            link: url,
                            underline: true,
                            width: PAGE.contentWidth,
                        });
                    doc.moveDown(0.2);
                });
            }
            doc.moveDown(0.5);
        });
    } else {
        // Fallback: raw message
        ensureSpace(doc, 30);
        doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
            .text(issue.message, PAGE.margin, doc.y, { width: PAGE.contentWidth, lineGap: 3 });
        doc.moveDown(0.5);
    }

    // Separator line
    doc.strokeColor(COLORS.border).lineWidth(0.5)
        .moveTo(PAGE.margin, doc.y)
        .lineTo(PAGE.width - PAGE.margin, doc.y)
        .stroke();
    doc.moveDown(1);
}

router.get('/pdf', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) throw new AppError('Authentication required', 401);

        const connection = await prisma.qbConnection.findFirst({
            where: { tenantId, subscriptionStatus: 'ACTIVE' },
            orderBy: { lastSyncAt: 'desc' },
        });
        if (!connection) throw new AppError('No active connection found', 404);

        const connectionId = connection.id;
        const diagnosticRun = await prisma.diagnosticRun.findFirst({
            where: { connectionId },
            orderBy: { runAt: 'desc' },
        });
        if (!diagnosticRun) throw new AppError('No diagnostic runs found for this connection', 404);

        const issues = await prisma.issue.findMany({ where: { connectionId } });
        const checks = await prisma.diagnosticCheck.findMany({ where: { runId: diagnosticRun.id } });

        const uniqueIssuesMap = new Map<string, typeof issues[0]>();
        for (const issue of issues) {
            if (!uniqueIssuesMap.has(issue.ruleId)) uniqueIssuesMap.set(issue.ruleId, issue);
        }
        const uniqueIssues = Array.from(uniqueIssuesMap.values());

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="qb-health-report-${connectionId.slice(0, 8)}.pdf"`);

        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: PAGE.margin, left: PAGE.margin, right: PAGE.margin, bottom: 30 }
        });

        let pageCount = 1;
        doc.on('pageAdded', () => {
            pageCount++;
            drawFooter(doc, pageCount);
        });

        doc.pipe(res);

        drawCoverPage(doc, diagnosticRun, issues, checks, uniqueIssues);
        drawFooter(doc, 1);

        doc.addPage();

        doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.ink).text('Diagnostic Findings', PAGE.margin, doc.y);
        doc.moveDown(0.4);
        doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text('Rule violations identified during the latest QuickBooks health diagnostic.', PAGE.margin, doc.y);
        doc.moveDown(1.5);

        if (uniqueIssues.length === 0) {
            doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted).text('No issues detected. Your financial hygiene looks great.', PAGE.margin, doc.y);
        } else {
            uniqueIssues.forEach((issue: any, index: number) => {
                drawFinding(doc, issue, index);
            });
        }

        doc.end();
    } catch (error) {
        next(error);
    }
});

export default router;