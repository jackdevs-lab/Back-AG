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
    ink: '#111827',
    dark: '#1F2937',
    muted: '#6B7280',
    subtle: '#9CA3AF',

    border: '#E5E7EB',
    background: '#F8FAFC',
    white: '#FFFFFF',

    primary: '#2563EB',
    primaryDark: '#1D4ED8',
    primaryLight: '#EFF6FF',

    success: '#059669',
    successLight: '#ECFDF5',

    warning: '#D97706',
    warningLight: '#FFFBEB',

    danger: '#DC2626',
    dangerLight: '#FEF2F2',

    info: '#4F46E5',
    infoLight: '#EEF2FF',
};

const PAGE = {
    width: 595.28,
    height: 841.89,

    margin: 48,
    contentWidth: 595.28 - 96,
    bottom: 780,
};

/* -------------------------------------------------------------------------- */
/*                                  HELPERS                                   */
/* -------------------------------------------------------------------------- */

function getSeverityStyle(severity: string) {
    const normalized = severity.toUpperCase();

    if (normalized.includes('CRITICAL') || normalized.includes('ERROR')) {
        return {
            color: COLORS.danger,
            background: COLORS.dangerLight,
            label: 'CRITICAL',
        };
    }

    if (normalized.includes('WARNING') || normalized.includes('WARN')) {
        return {
            color: COLORS.warning,
            background: COLORS.warningLight,
            label: 'WARNING',
        };
    }

    if (normalized.includes('INFO')) {
        return {
            color: COLORS.info,
            background: COLORS.infoLight,
            label: 'INFO',
        };
    }

    return {
        color: COLORS.muted,
        background: '#F3F4F6',
        label: normalized || 'FINDING',
    };
}

function getScoreStyle(score: number | null | undefined) {
    if (score === null || score === undefined) {
        return {
            color: COLORS.muted,
            label: 'N/A',
        };
    }

    if (score >= 90) {
        return {
            color: COLORS.success,
            label: 'Excellent',
        };
    }

    if (score >= 75) {
        return {
            color: COLORS.primary,
            label: 'Good',
        };
    }

    if (score >= 60) {
        return {
            color: COLORS.warning,
            label: 'Needs Attention',
        };
    }

    return {
        color: COLORS.danger,
        label: 'At Risk',
    };
}

function drawRoundedRect(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    height: number,
    radius = 8
) {
    doc.roundedRect(x, y, width, height, radius);
}

function drawFooter(doc: PDFKit.PDFDocument) {
    const pageNumber = doc.bufferedPageRange().count;

    doc.save();

    doc
        .strokeColor(COLORS.border)
        .lineWidth(0.6)
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
    doc.addPage({
        size: 'A4',
        margin: PAGE.margin,
    });

    drawFooter(doc);
}

function ensureSpace(
    doc: PDFKit.PDFDocument,
    requiredHeight: number
): void {
    if (doc.y + requiredHeight > PAGE.bottom) {
        addPage(doc);
    }
}

function drawSectionTitle(
    doc: PDFKit.PDFDocument,
    title: string,
    subtitle?: string
) {
    ensureSpace(doc, subtitle ? 55 : 35);

    doc
        .font('Helvetica-Bold')
        .fontSize(16)
        .fillColor(COLORS.ink)
        .text(title);

    if (subtitle) {
        doc
            .moveDown(0.25)
            .font('Helvetica')
            .fontSize(9)
            .fillColor(COLORS.muted)
            .text(subtitle);
    }

    doc.moveDown(0.7);
}

function drawBadge(
    doc: PDFKit.PDFDocument,
    text: string,
    x: number,
    y: number,
    color: string,
    background: string
) {
    const width = doc.widthOfString(text) + 18;

    doc
        .save()
        .fillColor(background)
        .roundedRect(x, y, width, 19, 9)
        .fill();

    doc
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .fillColor(color)
        .text(text, x + 9, y + 6, {
            width: width - 18,
            align: 'center',
        });

    doc.restore();

    return width;
}

/* -------------------------------------------------------------------------- */
/*                              SCORE VISUAL                                  */
/* -------------------------------------------------------------------------- */

function drawScoreCircle(
    doc: PDFKit.PDFDocument,
    score: number | null | undefined,
    centerX: number,
    centerY: number,
    radius: number
) {
    const scoreValue = score ?? 0;
    const scoreStyle = getScoreStyle(score);

    // Background circle
    doc
        .save()
        .lineWidth(10)
        .strokeColor('#E5E7EB')
        .circle(centerX, centerY, radius)
        .stroke();

    // Score arc
    if (score !== null && score !== undefined) {
        const degrees = Math.max(0, Math.min(scoreValue, 100)) * 3.6;

        (doc as any)
            .lineWidth(10)
            .lineCap('round')
            .strokeColor(scoreStyle.color)
            .arc(
                centerX,
                centerY,
                radius,
                -90 * (Math.PI / 180),
                (-90 + degrees) * (Math.PI / 180)
            )
            .stroke();
    }

    doc
        .font('Helvetica-Bold')
        .fontSize(28)
        .fillColor(COLORS.ink)
        .text(
            score !== null && score !== undefined
                ? String(score)
                : 'N/A',
            centerX - radius,
            centerY - 15,
            {
                width: radius * 2,
                align: 'center',
            }
        );

    if (score !== null && score !== undefined) {
        doc
            .font('Helvetica')
            .fontSize(8)
            .fillColor(COLORS.muted)
            .text('/ 100', centerX - radius, centerY + 17, {
                width: radius * 2,
                align: 'center',
            });
    }

    doc.restore();
}

/* -------------------------------------------------------------------------- */
/*                            SUMMARY CARD                                    */
/* -------------------------------------------------------------------------- */

function drawSummaryCard(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    height: number,
    value: string | number,
    label: string
) {
    doc
        .save()
        .fillColor(COLORS.white)
        .strokeColor(COLORS.border)
        .lineWidth(0.7);

    drawRoundedRect(doc, x, y, width, height, 8);
    doc.fillAndStroke();

    doc
        .font('Helvetica-Bold')
        .fontSize(17)
        .fillColor(COLORS.ink)
        .text(String(value), x + 14, y + 13, {
            width: width - 28,
        });

    doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(COLORS.muted)
        .text(label, x + 14, y + 37, {
            width: width - 28,
        });

    doc.restore();
}

/* -------------------------------------------------------------------------- */
/*                             FINDING CARD                                   */
/* -------------------------------------------------------------------------- */

function drawFindingCard(
    doc: PDFKit.PDFDocument,
    issue: any,
    index: number
) {
    const parsed = parseMarkdownFindings(issue.message);
    const severity = getSeverityStyle(issue.severity);

    /*
     * Estimate the card height conservatively.
     * If the content exceeds the page, individual sections below
     * will create new pages as necessary.
     */
    ensureSpace(doc, 105);

    const cardX = PAGE.margin;
    const cardWidth = PAGE.contentWidth;
    const cardTop = doc.y;

    // Card background
    doc
        .save()
        .fillColor(COLORS.white)
        .strokeColor(COLORS.border)
        .lineWidth(0.7);

    drawRoundedRect(doc, cardX, cardTop, cardWidth, 90, 9);
    doc.fillAndStroke();
    doc.restore();

    // Severity strip
    doc
        .save()
        .fillColor(severity.color)
        .roundedRect(cardX, cardTop, 4, 90, 2)
        .fill()
        .restore();

    // Number
    doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(COLORS.subtle)
        .text(
            `RULE ${String(index + 1).padStart(2, '0')}`,
            cardX + 17,
            cardTop + 13
        );

    // Badge
    const badgeText = severity.label;
    const badgeWidth = doc.widthOfString(badgeText) + 18;

    drawBadge(
        doc,
        badgeText,
        cardX + cardWidth - badgeWidth - 15,
        cardTop + 10,
        severity.color,
        severity.background
    );

    // Rule name
    doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor(COLORS.ink)
        .text(issue.ruleName, cardX + 17, cardTop + 30, {
            width: cardWidth - 150,
        });

    // Content begins after header
    doc.y = cardTop + 60;

    if (parsed.findings.length > 0) {
        parsed.findings.forEach(
            (finding: DiagnosticFinding, findingIndex: number) => {
                drawFindingContent(doc, finding, findingIndex);
            }
        );
    } else {
        ensureSpace(doc, 45);

        doc
            .font('Helvetica')
            .fontSize(9.5)
            .fillColor(COLORS.muted)
            .text(`Summary: ${issue.message}`, {
                width: PAGE.contentWidth - 20,
                lineGap: 3,
            });

        doc.moveDown(0.8);
    }

    doc.moveDown(0.8);
}

function drawFindingContent(
    doc: PDFKit.PDFDocument,
    finding: DiagnosticFinding,
    findingIndex: number
) {
    ensureSpace(doc, 85);

    const contentX = PAGE.margin + 17;
    const contentWidth = PAGE.contentWidth - 34;

    // Finding type
    if (finding.type) {
        doc
            .font('Helvetica-Bold')
            .fontSize(9.5)
            .fillColor(COLORS.dark)
            .text(finding.type, contentX, doc.y, {
                width: contentWidth,
            });

        doc.moveDown(0.3);
    }

    // Description
    if (finding.description) {
        doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor(COLORS.muted)
            .text(finding.description, {
                width: contentWidth,
                lineGap: 3,
            });

        doc.moveDown(0.5);
    }

    // QuickBooks links
    if (finding.urls.length > 0) {
        ensureSpace(doc, 35);

        finding.urls.forEach((url, urlIdx) => {
            ensureSpace(doc, 22);

            const linkLabel =
                finding.urls.length === 1
                    ? 'Open in QuickBooks'
                    : `Open QuickBooks Link ${urlIdx + 1}`;

            doc
                .font('Helvetica-Bold')
                .fontSize(8.5)
                .fillColor(COLORS.primary)
                .text(`↗  ${linkLabel}`, contentX, doc.y, {
                    link: url,
                    underline: true,
                    width: contentWidth,
                });

            doc.moveDown(0.25);
        });
    }

    if (findingIndex < 1000) {
        doc.moveDown(0.55);
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
        .fontSize(11)
        .fillColor(COLORS.primary)
        .text('AUDIT GEN');

    doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(COLORS.subtle)
        .text('QUICKBOOKS HEALTH DIAGNOSTICS');

    doc.moveDown(2.5);

    // Main title
    doc
        .font('Helvetica-Bold')
        .fontSize(27)
        .fillColor(COLORS.ink)
        .text('Financial Health');

    doc
        .font('Helvetica-Bold')
        .fontSize(27)
        .fillColor(COLORS.primary)
        .text('Audit Report');

    doc.moveDown(0.6);

    doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(COLORS.muted)
        .text(
            `Generated ${new Date().toISOString().split('T')[0]}`,
            {
                width: PAGE.contentWidth,
            }
        );

    doc.moveDown(2);

    // Score panel
    const panelX = PAGE.margin;
    const panelY = doc.y;
    const panelWidth = PAGE.contentWidth;
    const panelHeight = 205;

    doc
        .save()
        .fillColor(COLORS.ink)
        .roundedRect(panelX, panelY, panelWidth, panelHeight, 12)
        .fill()
        .restore();

    // Score
    drawScoreCircle(
        doc,
        diagnosticRun.healthScore,
        panelX + 110,
        panelY + 100,
        65
    );

    const scoreStyle = getScoreStyle(diagnosticRun.healthScore);

    doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(COLORS.white)
        .text('FINANCIAL HEALTH SCORE', panelX + 205, panelY + 45);

    doc
        .font('Helvetica-Bold')
        .fontSize(17)
        .fillColor(COLORS.white)
        .text(scoreStyle.label, panelX + 205, panelY + 66);

    doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#CBD5E1')
        .text(
            'A consolidated assessment of the accounting data examined during this diagnostic run.',
            panelX + 205,
            panelY + 95,
            {
                width: 245,
                lineGap: 3,
            }
        );

    doc.y = panelY + panelHeight + 25;

    // Summary cards
    const gap = 10;
    const cardWidth = (PAGE.contentWidth - gap * 2) / 3;

    drawSummaryCard(
        doc,
        PAGE.margin,
        doc.y,
        cardWidth,
        65,
        issues.length,
        'ISSUES DETECTED'
    );

    drawSummaryCard(
        doc,
        PAGE.margin + cardWidth + gap,
        doc.y,
        cardWidth,
        65,
        checks.length,
        'CHECKS PERFORMED'
    );

    drawSummaryCard(
        doc,
        PAGE.margin + (cardWidth + gap) * 2,
        doc.y,
        cardWidth,
        65,
        uniqueIssues.length,
        'RULES FLAGGED'
    );

    doc.y += 95;

    // Executive assessment
    doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor(COLORS.ink)
        .text('Executive Assessment');

    doc.moveDown(0.4);

    const score = diagnosticRun.healthScore;

    let assessment =
        'The diagnostic identified areas requiring review within the connected QuickBooks data.';

    if (score !== null && score !== undefined) {
        if (score >= 90) {
            assessment =
                'The account is in strong overall condition, with a small number of issues identified for review.';
        } else if (score >= 75) {
            assessment =
                'The account is generally healthy, although several items should be reviewed to maintain clean financial records.';
        } else if (score >= 60) {
            assessment =
                'The diagnostic identified several areas that require attention and follow-up.';
        } else {
            assessment =
                'The diagnostic identified significant issues that should be investigated and resolved as a priority.';
        }
    }

    doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor(COLORS.muted)
        .text(assessment, {
            width: PAGE.contentWidth,
            lineGap: 4,
        });

    doc.moveDown(1);

    doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(COLORS.subtle)
        .text(
            'This report is generated from the latest completed diagnostic run and is intended to assist with accounting review and remediation.',
            {
                width: PAGE.contentWidth,
                lineGap: 3,
            }
        );
}

/* -------------------------------------------------------------------------- */
/*                             REPORT ROUTE                                   */
/* -------------------------------------------------------------------------- */

// Secure endpoint: uses authenticated tenant, no client-supplied connectionId
router.get(
    '/pdf',
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const tenantId = req.tenantId;

            if (!tenantId) {
                throw new AppError('Authentication required', 401);
            }

            // Find latest active connection for this tenant
            const connection = await prisma.qbConnection.findFirst({
                where: {
                    tenantId,
                    subscriptionStatus: 'ACTIVE',
                },
                orderBy: {
                    lastSyncAt: 'desc',
                },
            });

            if (!connection) {
                throw new AppError('No active connection found', 404);
            }

            const connectionId = connection.id;

            const diagnosticRun =
                await prisma.diagnosticRun.findFirst({
                    where: {
                        connectionId,
                    },
                    orderBy: {
                        runAt: 'desc',
                    },
                });

            if (!diagnosticRun) {
                throw new AppError(
                    'No diagnostic runs found for this connection',
                    404
                );
            }

            // Fetch all issues and checks
            const issues = await prisma.issue.findMany({
                where: {
                    connectionId,
                },
            });

            const checks = await prisma.diagnosticCheck.findMany({
                where: {
                    runId: diagnosticRun.id,
                },
            });

            // Group issues by ruleId to avoid duplication;
            // we'll render one report per rule
            const uniqueIssuesMap = new Map<
                string,
                typeof issues[0]
            >();

            for (const issue of issues) {
                if (!uniqueIssuesMap.has(issue.ruleId)) {
                    uniqueIssuesMap.set(issue.ruleId, issue);
                }
            }

            const uniqueIssues = Array.from(
                uniqueIssuesMap.values()
            );

            res.setHeader(
                'Content-Type',
                'application/pdf'
            );

            res.setHeader(
                'Content-Disposition',
                `attachment; filename="qb-health-report-${connectionId.slice(
                    0,
                    8
                )}.pdf"`
            );

            const doc = new PDFDocument({
                margin: PAGE.margin,
                size: 'A4',
                bufferPages: true,
                info: {
                    Title: 'Audit Gen — QuickBooks Financial Health Audit',
                    Author: 'Audit Gen',
                    Subject:
                        'QuickBooks Financial Health Diagnostic Report',
                    Creator: 'Audit Gen',
                },
            });

            doc.pipe(res);

            /* ----------------------------- COVER ----------------------------- */

            drawCoverPage(
                doc,
                diagnosticRun,
                issues,
                checks,
                uniqueIssues
            );

            /* ------------------------- FINDINGS PAGE ------------------------- */

            addPage(doc);

            drawSectionTitle(
                doc,
                'Diagnostic Findings',
                'Rule violations identified during the latest QuickBooks health diagnostic.'
            );

            if (uniqueIssues.length === 0) {
                // Empty state
                const emptyY = doc.y;

                doc
                    .save()
                    .fillColor(COLORS.successLight)
                    .strokeColor('#A7F3D0')
                    .lineWidth(0.7);

                drawRoundedRect(
                    doc,
                    PAGE.margin,
                    emptyY,
                    PAGE.contentWidth,
                    115,
                    10
                );

                doc.fillAndStroke();
                doc.restore();

                doc
                    .font('Helvetica-Bold')
                    .fontSize(12)
                    .fillColor(COLORS.success)
                    .text(
                        'No issues detected',
                        PAGE.margin + 20,
                        emptyY + 25
                    );

                doc
                    .font('Helvetica')
                    .fontSize(9.5)
                    .fillColor(COLORS.dark)
                    .text(
                        'Your financial hygiene looks great. No rule violations were identified during this diagnostic run.',
                        PAGE.margin + 20,
                        emptyY + 50,
                        {
                            width: PAGE.contentWidth - 40,
                            lineGap: 4,
                        }
                    );
            } else {
                uniqueIssues.forEach(
                    (issue: any, index: number) => {
                        drawFindingCard(
                            doc,
                            issue,
                            index
                        );
                    }
                );
            }

            /* ----------------------------- FOOTERS ---------------------------- */

            // Apply footer to every buffered page.
            const range = doc.bufferedPageRange();

            for (
                let pageIndex = range.start;
                pageIndex < range.start + range.count;
                pageIndex++
            ) {
                doc.switchToPage(pageIndex);

                // Footer may already have been drawn by addPage().
                // Draw it here only for the cover page.
                if (pageIndex === 0) {
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