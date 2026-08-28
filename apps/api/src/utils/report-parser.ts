// apps/api/src/utils/report-parser.ts
export interface DiagnosticFinding {
    id: string;
    type: string;
    url: string;       // primary URL
    urls: string[];    // all URLs found in the finding
    description: string;
}

export interface ParsedMarkdownResult {
    findings: DiagnosticFinding[];
    totalExposure: string | null;
    recommendation: string | null;
}

// Helper to extract all URLs from a string
function extractUrls(text: string): string[] {
    const urls: string[] = [];
    const regex = /https?:\/\/[^\s\)]+/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        urls.push(match[0]);
    }
    return urls;
}

export function parseMarkdownFindings(message: string): ParsedMarkdownResult {
    if (!message) {
        return { findings: [], totalExposure: null, recommendation: null };
    }

    // Try JSON parsing first
    try {
        const parsedJson = JSON.parse(message);
        if (Array.isArray(parsedJson)) {
            return {
                findings: parsedJson.map((item: any, idx: number) => {
                    const urls = extractUrls(String(item.url || item.qbLink || ''));
                    return {
                        id: String(item.id || item.txnId || `ID-${idx}`),
                        type: String(item.type || item.entityType || 'Audit Item'),
                        url: urls[0] || '',
                        urls,
                        description: String(item.description || item.message || '')
                            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                            .replace(/\*\*/g, '')
                    };
                }),
                totalExposure: null,
                recommendation: null
            };
        }
    } catch (e) {
        // continue to markdown parser
    }

    const findings: DiagnosticFinding[] = [];
    let totalExposure: string | null = null;
    let recommendation: string | null = null;

    // Extract total exposure
    const exposureMatch = message.match(/cumulative exposure of\s+\$([\d,.]+)/i);
    if (exposureMatch && exposureMatch[1]) {
        totalExposure = `$${exposureMatch[1]}`;
    }

    // Extract recommendation
    const recSectionStart = message.indexOf('### Recommended Remediation');
    if (recSectionStart !== -1) {
        const afterHeading = message.substring(recSectionStart + '### Recommended Remediation'.length);
        const blockquoteMatch = afterHeading.match(/>\s*(.*?)(?:\n|$)/);
        if (blockquoteMatch && blockquoteMatch[1]) {
            recommendation = blockquoteMatch[1].trim()
                .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                .replace(/\*\*/g, '');
        }
    }

    // Find detailed findings section
    const findingsHeading = '### Detailed Findings';
    const findingsStartIdx = message.indexOf(findingsHeading);
    if (findingsStartIdx === -1) {
        // Fallback: try to extract URLs from the whole message as one finding
        const urls = extractUrls(message);
        if (urls.length > 0) {
            findings.push({
                id: 'finding-1',
                type: 'Finding',
                url: urls[0],
                urls,
                description: message.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*/g, '')
            });
        }
        return { findings, totalExposure, recommendation };
    }

    const findingsContent = message.substring(findingsStartIdx + findingsHeading.length);
    const remediationIdx = findingsContent.indexOf('### Recommended Remediation');
    const findingsOnly = remediationIdx !== -1 ? findingsContent.substring(0, remediationIdx) : findingsContent;

    // Regex to match each numbered item
    const findingRegex = /###\s+\d+\.\s+([^\n]+)\n([\s\S]*?)(?=###\s+\d+\.|$)/g;
    let match;
    let idx = 0;

    while ((match = findingRegex.exec(findingsOnly)) !== null) {
        idx++;
        const label = match[1].trim();
        const body = match[2];

        // Extract all URLs from the body
        const urls = extractUrls(body);
        const primaryUrl = urls.length > 0 ? urls[0] : '';

        // Clean description: remove markdown link syntax and bold
        let description = body;

        // Remove the Impact Details and QuickBooks Reference prefixes if present
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

        // Remove all markdown links, keep text
        description = description.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        description = description.replace(/\*\*([^*]+)\*\*/g, '$1');
        description = description.replace(/__([^_]+)__/g, '$1');
        description = description.trim();

        findings.push({
            id: `finding-${idx}`,
            type: label,
            url: primaryUrl,
            urls,
            description,
        });
    }

    return { findings, totalExposure, recommendation };
}