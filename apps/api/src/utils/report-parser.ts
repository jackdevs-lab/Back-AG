// apps/api/src/utils/report-parser.ts

export interface DiagnosticFinding {
    id: string;
    type: string;
    url: string;
    description: string;
}

export interface ParsedMarkdownResult {
    findings: DiagnosticFinding[];
    totalExposure: string | null;
    recommendation: string | null;
}

export function parseMarkdownFindings(message: string): ParsedMarkdownResult {
    if (!message) {
        return { findings: [], totalExposure: null, recommendation: null };
    }

    // 1. Try JSON parsing
    try {
        const parsedJson = JSON.parse(message);
        if (Array.isArray(parsedJson)) {
            return {
                findings: parsedJson.map((item: any, idx: number) => ({
                    id: String(item.id || item.txnId || `ID-${idx}`),
                    type: String(item.type || item.entityType || 'Audit Item'),
                    url: String(item.url || item.qbLink || '#'),
                    description: String(item.description || item.message || '')
                        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                        .replace(/\*\*/g, '')
                })),
                totalExposure: null,
                recommendation: null
            };
        }
    } catch (e) {
        // continue to markdown parser
    }

    // 2. Parse markdown format produced by formatStandardReport
    const findings: DiagnosticFinding[] = [];
    let totalExposure: string | null = null;
    let recommendation: string | null = null;

    const exposureMatch = message.match(/cumulative exposure of\s+\$([\d,.]+)/i);
    if (exposureMatch && exposureMatch[1]) {
        totalExposure = `$${exposureMatch[1]}`;
    }

    const recSectionStart = message.indexOf('### Recommended Remediation');
    if (recSectionStart !== -1) {
        const afterHeading = message.substring(recSectionStart + '### Recommended Remediation'.length);
        const blockquoteMatch = afterHeading.match(/>\s*(.*?)(?:\n|$)/);
        if (blockquoteMatch && blockquoteMatch[1]) {
            recommendation = blockquoteMatch[1].trim();
            recommendation = recommendation.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*/g, '');
        }
    }

    const findingsHeading = '### Detailed Findings';
    const findingsStartIdx = message.indexOf(findingsHeading);
    if (findingsStartIdx === -1) {
        return { findings, totalExposure, recommendation };
    }

    const findingsContent = message.substring(findingsStartIdx + findingsHeading.length);
    const remediationIdx = findingsContent.indexOf('### Recommended Remediation');
    const findingsOnly = remediationIdx !== -1 ? findingsContent.substring(0, remediationIdx) : findingsContent;

    const findingRegex = /###\s+\d+\.\s+([^\n]+)\n([\s\S]*?)(?=###\s+\d+\.|$)/g;
    let match: RegExpExecArray | null;
    let idx = 0;

    while ((match = findingRegex.exec(findingsOnly)) !== null) {
        idx++;
        const label = match[1].trim();
        const body = match[2];

        let url = '';
        const linkMatch = body.match(/\[Open in QuickBooks\]\((.*?)\)/);
        if (linkMatch && linkMatch[1]) {
            url = linkMatch[1].trim();
        } else {
            const anyLink = body.match(/\[(.*?)\]\((https?:\/\/\S+)\)/);
            if (anyLink && anyLink[2]) {
                url = anyLink[2].trim();
            }
        }

        let description = body;

        const impactRegex = /(?:-\s*)?\*\*Impact Details:\*\*/i;
        const impactMatch = description.match(impactRegex);
        if (impactMatch) {
            description = description.substring(impactMatch.index! + impactMatch[0].length);
        }

        const qbRegex = /(?:-\s*)?\*\*QuickBooks Reference:\*\*/i;
        const qbMatch = description.match(qbRegex);
        if (qbMatch) {
            description = description.substring(0, qbMatch.index!);
        }

        description = description.replace(/\[Open in QuickBooks\]\([^)]+\)/gi, '');
        description = description.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        description = description.replace(/\*\*([^*]+)\*\*/g, '$1');
        description = description.replace(/__([^_]+)__/g, '$1');
        description = description.trim();

        findings.push({
            id: `finding-${idx}`,
            type: label,
            url,
            description,
        });
    }

    return { findings, totalExposure, recommendation };
}