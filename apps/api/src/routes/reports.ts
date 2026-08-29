import { Router, Response, NextFunction } from 'express';
import { prisma } from '@qb-health/financial-model';
import { AppError } from '../middleware/error-handler';
import PDFDocument from 'pdfkit';
import { parseMarkdownFindings, DiagnosticFinding } from '../utils/report-parser';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router: Router = Router();
router.use(authMiddleware);

/* -------------------------------------------------------------------------- */
/*                                   THEME                                    */
/* -------------------------------------------------------------------------- */

const COLORS = {
    ink: '#1a1a1a',
    dark: '#333333',
    muted: '#666666',
    subtle: '#999999',
    border: '#cccccc',
    background: '#ffffff',
    lightBg: '#f7f7f7',
    white: '#ffffff',
    primary: '#1a4d8f',
    success: '#2e7d32',
    warning: '#b26a00',
    danger: '#b71c1c',
};

const PAGE = {
    width: 595.28,
    height: 841.89,
    margin: 64,
    contentWidth: 595.28 - 128,
    bottom: 800,
};

/* -------------------------------------------------------------------------- */
/*                                  HELPERS                                   */
/* -------------------------------------------------------------------------- */

function getSeverityColor(severity: string): string {
    const s = severity.toUpperCase();
    if (s.includes('CRITICAL') || s.includes('ERROR')) return COLORS.danger;
    if (s.includes('WARNING') || s.includes('WARN')) return COLORS.warning;
    if (s.includes('INFO')) return COLORS.muted;
    return COLORS.muted;
}

function drawFooter(doc: PDFKit.PDFDocument) {
    const pageNumber = doc.bufferedPageRange().count;
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
        });
    doc
        .fontSize(7.5)
        .text(`Page ${pageNumber}`, PAGE.width - PAGE.margin - 80, 800, {
            width: 80,
            align: 'right',
        });
    doc.restore();
}

function ensureSpace(doc: PDFKit.PDFDocument, requiredHeight: number) {
    if (doc.y + requiredHeight > PAGE.bottom) {
        doc.addPage();
    }
}

/* -------------------------------------------------------------------------- */
/*                              COVER PAGE                                    */
/* -------------------------------------------------------------------------- */

function drawCoverPage(
    doc: PDFKit.PDFDocument,
    diagnosticRun: any,
    issues: any[],
    checks: any[],
    uniqueIssues: any[]
) {
    // Top branding
    doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor(COLORS.primary)
        .text('AUDIT GEN');
    doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(COLORS.subtle)
        .text('QuickBooks Health Diagnostics');
    doc.moveDown(3);

    // Title
    doc
        .font('Helvetica-Bold')
        .fontSize(24)
        .fillColor(COLORS.ink)
        .text('Financial Health Audit Report', { width: PAGE.contentWidth });
    doc.moveDown(0.5);
    doc
        .font('Helvetica')
        .fontSize(11)
        .fillColor(COLORS.muted)
        .text(`Generated ${new Date().toISOString().split('T')[0]}`, {
            width: PAGE.contentWidth,
        });
    doc.moveDown(2);

    // Summary metrics table
    const tableTop = doc.y;
    const colWidths = [
        PAGE.contentWidth * 0.4,
        PAGE.contentWidth * 0.3,
        PAGE.contentWidth * 0.3
    ];
    const rowHeight = 30;

    // Table header
    doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(COLORS.white);
    doc
        .rect(PAGE.margin, tableTop, PAGE.contentWidth, rowHeight)
        .fill(COLORS.primary);
    doc
        .fillColor(COLORS.white)
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
        doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor(COLORS.ink);
        doc.text(row[0], PAGE.margin + 8, y + 10, { width: colWidths[0] - 16 });
        doc.text(String(row[1]), PAGE.margin + colWidths[0] + 8, y + 10, { width: colWidths[1] - 16 });
        doc.text(row[2], PAGE.margin + colWidths[0] + colWidths[1] + 8, y + 10, { width: colWidths[2] - 16 });
        y += rowHeight;
    });

    doc.moveDown(2);

    // Executive summary
    doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor(COLORS.ink)
        .text('Executive Summary');
    doc.moveDown(0.4);

    const score = diagnosticRun.healthScore;
    let assessment = 'The diagnostic identified areas requiring review within the connected QuickBooks data.';
    if (score !== null && score !== undefined) {
        if (score >= 90) assessment = 'The account is in strong overall condition, with a small number of issues identified for review.';
        else if (score >= 75) assessment = 'The account is generally healthy, although several items should be reviewed to maintain clean financial records.';
        else if (score >= 60) assessment = 'The diagnostic identified several areas that require attention and follow-up.';
        else assessment = 'The diagnostic identified significant issues that should be investigated and resolved as a priority.';
    }
    doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(COLORS.muted)
        .text(assessment, { width: PAGE.contentWidth, lineGap: 4 });

    doc.moveDown(2);
    doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(COLORS.subtle)
        .text('This report is generated from the latest completed diagnostic run and is intended to assist with accounting review and remediation.', {
            width: PAGE.contentWidth,
            lineGap: 3,
        });

    // Draw footer on cover page
    drawFooter(doc);
}

/* -------------------------------------------------------------------------- */
/*                             FINDING SECTION                                */
/* -------------------------------------------------------------------------- */

function drawFinding(doc: PDFKit.PDFDocument, issue: any, index: number) {
    ensureSpace(doc, 60); // Reserve space for header at least

    // Header with rule name and severity
    doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor(COLORS.ink)
        .text(`${index + 1}. ${issue.ruleName}`, { width: PAGE.contentWidth - 100 });
    doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(getSeverityColor(issue.severity))
        .text(issue.severity.toUpperCase(), { align: 'right', width: 80, continued: false });
    // This will place severity at same line? Actually above code will put severity on next line because of continued false. We'll adjust later.

    // Simpler: put severity after rule name on same line using text with width
    doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(getSeverityColor(issue.severity))
        .text(issue.severity.toUpperCase(), PAGE.margin + PAGE.contentWidth - 80, doc.y - 14, { width: 80, align: 'right' });

    doc.moveDown(0.5);

    const parsed = parseMarkdownFindings(issue.message);
    if (parsed.findings.length > 0) {
        parsed.findings.forEach((finding: DiagnosticFinding) => {
            // Type
            if (finding.type) {
                ensureSpace(doc, 20);
                doc
                    .font('Helvetica-Bold')
                    .fontSize(9.5)
                    .fillColor(COLORS.dark)
                    .text(finding.type, { width: PAGE.contentWidth });
                doc.moveDown(0.2);
            }

            // Description
            if (finding.description) {
                ensureSpace(doc, 30);
                doc
                    .font('Helvetica')
                    .fontSize(9)
                    .fillColor(COLORS.muted)
                    .text(finding.description, { width: PAGE.contentWidth, lineGap: 3 });
                doc.moveDown(0.3);
            }

            // Links
            if (finding.urls.length > 0) {
                ensureSpace(doc, 25);
                finding.urls.forEach((url, urlIdx) => {
                    ensureSpace(doc, 20);
                    const linkLabel =
                        finding.urls.length === 1
                            ? 'Open in QuickBooks'
                            : `Open QuickBooks Link ${urlIdx + 1}`;
                    doc
                        .font('Helvetica')
                        .fontSize(8.5)
                        .fillColor(COLORS.primary)
                        .text(linkLabel, {
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
        doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor(COLORS.muted)
            .text(issue.message, { width: PAGE.contentWidth, lineGap: 3 });
        doc.moveDown(0.5);
    }

    // Horizontal rule after each finding
    doc
        .strokeColor(COLORS.border)
        .lineWidth(0.5)
        .moveTo(PAGE.margin, doc.y)
        .lineTo(PAGE.width - PAGE.margin, doc.y)
        .stroke();
    doc.moveDown(1);
}

/* -------------------------------------------------------------------------- */
/*                             REPORT ROUTE                                   */
/* -------------------------------------------------------------------------- */

router.get(
    '/pdf',
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const tenantId = req.tenantId;
            if (!tenantId) {
                throw new AppError('Authentication required', 401);
            }

            const connection = await prisma.qbConnection.findFirst({
                where: { tenantId, subscriptionStatus: 'ACTIVE' },
                orderBy: { lastSyncAt: 'desc' },
            });

            if (!connection) {
                throw new AppError('No active connection found', 404);
            }

            const connectionId = connection.id;

            const diagnosticRun = await prisma.diagnosticRun.findFirst({
                where: { connectionId },
                orderBy: { runAt: 'desc' },
            });

            if (!diagnosticRun) {
                throw new AppError('No diagnostic runs found for this connection', 404);
            }

            const issues = await prisma.issue.findMany({ where: { connectionId } });
            const checks = await prisma.diagnosticCheck.findMany({
                where: { runId: diagnosticRun.id },
            });

            // Unique issues per rule
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

            const doc = new PDFDocument({
                margin: PAGE.margin,
                size: 'A4',
                bufferPages: true,
                info: {
                    Title: 'Audit Gen — QuickBooks Financial Health Audit',
                    Author: 'Audit Gen',
                    Subject: 'QuickBooks Financial Health Diagnostic Report',
                    Creator: 'Audit Gen',
                },
            });

            // Footer on every page (except cover handled manually)
            doc.on('pageAdded', () => {
                drawFooter(doc);
            });

            doc.pipe(res);

            // Cover page
            drawCoverPage(doc, diagnosticRun, issues, checks, uniqueIssues);

            // Start findings on a new page
            doc.addPage();

            doc
                .font('Helvetica-Bold')
                .fontSize(16)
                .fillColor(COLORS.ink)
                .text('Diagnostic Findings');
            doc.moveDown(0.4);
            doc
                .font('Helvetica')
                .fontSize(9)
                .fillColor(COLORS.muted)
                .text('Rule violations identified during the latest QuickBooks health diagnostic.');
            doc.moveDown(1.5);

            if (uniqueIssues.length === 0) {
                doc
                    .font('Helvetica')
                    .fontSize(10)
                    .fillColor(COLORS.muted)
                    .text('No issues detected. Your financial hygiene looks great.');
            } else {
                uniqueIssues.forEach((issue: any, index: number) => {
                    drawFinding(doc, issue, index);
                });
            }

            doc.end();
        } catch (error) {
            next(error);
        }
    }
);

export default router;