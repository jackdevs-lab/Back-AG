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
    primary: '#1a4d8f', // corporate blue
    primaryLight: '#e8f0fa',
    success: '#2e7d32',
    warning: '#b26a00',
    danger: '#b71c1c',
    info: '#1a4d8f',
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
    if (s.includes('INFO')) return COLORS.info;
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

function addPage(doc: PDFKit.PDFDocument) {
    doc.addPage({ size: 'A4', margin: PAGE.margin });
    drawFooter(doc);
}

function ensureSpace(doc: PDFKit.PDFDocument, requiredHeight: number) {
    if (doc.y + requiredHeight > PAGE.bottom) {
        addPage(doc);
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
    const colWidths = [PAGE.contentWidth * 0.4, PAGE.contentWidth * 0.3, PAGE.contentWidth * 0.3];
    const rowHeight = 40;

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
        .text('Metric', PAGE.margin + 8, tableTop + 12, { width: colWidths[0] - 16 })
        .text('Value', PAGE.margin + colWidths[0] + 8, tableTop + 12, { width: colWidths[1] - 16 })
        .text('Details', PAGE.margin + colWidths[0] + colWidths[1] + 8, tableTop + 12, { width: colWidths[2] - 16 });

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
        doc.text(row[0], PAGE.margin + 8, y + 12, { width: colWidths[0] - 16 });
        doc.text(String(row[1]), PAGE.margin + colWidths[0] + 8, y + 12, { width: colWidths[1] - 16 });
        doc.text(row[2], PAGE.margin + colWidths[0] + colWidths[1] + 8, y + 12, { width: colWidths[2] - 16 });
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

function drawFindingCard(doc: PDFKit.PDFDocument, issue: any, index: number) {
    ensureSpace(doc, 80);
    const cardX = PAGE.margin;
    const cardWidth = PAGE.contentWidth;
    const cardTop = doc.y;

    // Card border
    doc
        .save()
        .strokeColor(COLORS.border)
        .lineWidth(0.5)
        .roundedRect(cardX, cardTop, cardWidth, 0, 0) // will adjust height later
        .stroke();
    doc.restore();

    // Header
    doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(COLORS.ink)
        .text(`${index + 1}. ${issue.ruleName}`, cardX + 12, cardTop + 12, {
            width: cardWidth - 100,
        });

    // Severity label
    const sevColor = getSeverityColor(issue.severity);
    doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(sevColor)
        .text(issue.severity.toUpperCase(), cardX + cardWidth - 90, cardTop + 14, {
            width: 70,
            align: 'right',
        });

    doc.y = cardTop + 35;

    const parsed = parseMarkdownFindings(issue.message);

    if (parsed.findings.length > 0) {
        parsed.findings.forEach((finding: DiagnosticFinding) => {
            drawFindingContent(doc, finding);
        });
    } else {
        // Fallback: raw message
        ensureSpace(doc, 40);
        doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor(COLORS.muted)
            .text(issue.message, { width: cardWidth - 24, lineGap: 3 });
        doc.moveDown(0.5);
    }

    // Card bottom border
    const endY = doc.y + 8;
    doc
        .save()
        .strokeColor(COLORS.border)
        .lineWidth(0.5)
        .moveTo(cardX, endY)
        .lineTo(cardX + cardWidth, endY)
        .stroke();
    doc.restore();

    doc.moveDown(1);
}

function drawFindingContent(doc: PDFKit.PDFDocument, finding: DiagnosticFinding) {
    const contentX = PAGE.margin + 12;
    const contentWidth = PAGE.contentWidth - 24;

    if (finding.type) {
        ensureSpace(doc, 25);
        doc
            .font('Helvetica-Bold')
            .fontSize(9.5)
            .fillColor(COLORS.dark)
            .text(finding.type, contentX, doc.y, { width: contentWidth });
        doc.moveDown(0.2);
    }

    if (finding.description) {
        ensureSpace(doc, 45);
        doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor(COLORS.muted)
            .text(finding.description, { width: contentWidth, lineGap: 3 });
        doc.moveDown(0.4);
    }

    if (finding.urls.length > 0) {
        ensureSpace(doc, 30);
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
                .text(linkLabel, contentX, doc.y, {
                    link: url,
                    underline: true,
                    width: contentWidth,
                });
            doc.moveDown(0.2);
        });
    }

    doc.moveDown(0.5);
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

            doc.pipe(res);

            // Cover page
            drawCoverPage(doc, diagnosticRun, issues, checks, uniqueIssues);

            // Findings page
            addPage(doc);
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
                    drawFindingCard(doc, issue, index);
                });
            }

            // Ensure footer on all pages
            const range = doc.bufferedPageRange();
            for (let i = range.start; i < range.start + range.count; i++) {
                if (i > 0) {
                    doc.switchToPage(i);
                    drawFooter(doc);
                }
            }

            doc.end();
        } catch (error) {
            next(error);
        }
    }
);

export default router;