// core/pipeline-runner.ts
import { Prisma } from '@prisma/client';
import { BrandedRepository } from '@qb-health/financial-model';
import { RealmId } from '@qb-health/financial-model';
import { RuleContext, RuleExecutionResult, Issue, RuleId } from '../types';

export type DataResult<T> = T | AsyncGenerator<T[]>;

export class PipelineRunner<TData = any, TNorm = any, TDet = any, TEnriched = any> {
    private _dataStep?: (repo: BrandedRepository, realmId: RealmId) => Promise<any>;
    private _normStep?: (data: any) => any | Promise<any>;
    private _detStep?: (norm: any) => any | Promise<any>;
    private _enrichStep?: (det: any, ctx: RuleContext, norm: any) => any | Promise<any>;
    private _reportStep?: (enriched: any, ctx: RuleContext, norm: any) => string | Promise<string>;

    constructor(
        private ctx: RuleContext,
        private ruleId: RuleId,
        private ruleName: string,
        private version: string
    ) { }

    public withData(step: (repo: BrandedRepository, realmId: RealmId) => Promise<any>): this {
        this._dataStep = step;
        return this;
    }

    public withNormalization(step: (data: any) => any | Promise<any>): this {
        this._normStep = step;
        return this;
    }

    public withDetection(step: (norm: any) => any | Promise<any>): this {
        this._detStep = step;
        return this;
    }

    public withEnrichment(step: (det: any, ctx: RuleContext, norm: any) => any | Promise<any>): this {
        this._enrichStep = step;
        return this;
    }

    public withReporting(step: (enriched: any, ctx: RuleContext, norm: any) => string | Promise<string>): this {
        this._reportStep = step;
        return this;
    }


    private adaptAndValidateDetections(rawDetections: any): { findings: any[], [key: string]: any } {
        if (!rawDetections) {
            return { findings: [] };
        }

        if (Array.isArray(rawDetections)) {
            return { findings: rawDetections };
        }

        const adapted = { ...rawDetections };

        if (!Array.isArray(adapted.findings)) {
            const arrayKeys = Object.keys(adapted).filter(k => Array.isArray(adapted[k]));
            if (arrayKeys.length > 0) {
                adapted.findings = adapted[arrayKeys[0]];
            }
        }

        if (!Array.isArray(adapted.findings)) {
            throw new Error(
                `Pipeline Validation Error: Detection step must output a 'findings' array. ` +
                `Received keys: [${Object.keys(adapted).join(', ') || 'none'}]`
            );
        }

        return adapted;
    }

    public async execute(): Promise<RuleExecutionResult> {
        const { logger, realmId, repo } = this.ctx;
        const startTime = Date.now();

        try {
            if (!this._dataStep || !this._normStep || !this._detStep || !this._enrichStep || !this._reportStep) {
                throw new Error('Pipeline is incomplete. All 5 layers must be defined.');
            }

            const dataResult = await this._dataStep(repo, realmId);

            let finalEnriched: any;
            let finalNorm: any;

            if (this.isAsyncGenerator(dataResult)) {
                const allUnscannable: any[] = [];
                let aggregatedReportData: {
                    findingsSummary: { count: number; currencies: Map<any,any>; totalAmounts: Map<any,any> };
                    findingsForDisplay: any[];
                    processedCount: number;
                } = {
                    findingsSummary: { count: 0, currencies: new Map(), totalAmounts: new Map() },
                    findingsForDisplay: [],
                    processedCount: 0
                };

                for await (const batch of dataResult) {
                    const normalized = await this._normStep(batch);
                    const rawDetections = await this._detStep(normalized);
                    const detections = this.adaptAndValidateDetections(rawDetections);

                    if (detections.findings.length > 0) {
                        const enriched = await this._enrichStep(detections, this.ctx, normalized);

                        for (const finding of enriched) {
                            aggregatedReportData.findingsSummary.count++;

                            if (aggregatedReportData.findingsForDisplay.length < 100) {
                                aggregatedReportData.findingsForDisplay.push(finding);
                            }

                            const currency = finding.currency || 'USD';
                            const currentTotal = aggregatedReportData.findingsSummary.totalAmounts.get(currency) || new Prisma.Decimal(0);
                            aggregatedReportData.findingsSummary.totalAmounts.set(
                                currency,
                                currentTotal.add(finding.decimalAmount || finding.amount)
                            );
                        }
                    }

                    const errors = normalized?.unscannable || normalized?.errors || [];
                    allUnscannable.push(...errors);
                }

                const report = await this._reportStep(aggregatedReportData, this.ctx, allUnscannable);
                finalEnriched = aggregatedReportData;
                finalNorm = allUnscannable;
            }
            else {
                finalNorm = await this._normStep(dataResult);
                const rawDetections = await this._detStep(finalNorm);
                const detections = this.adaptAndValidateDetections(rawDetections);
                finalEnriched = await this._enrichStep(detections, this.ctx, finalNorm);
                const report = await this._reportStep(finalEnriched, this.ctx, finalNorm);
            }

            let findingsArray: any[] = [];

            if (this.isAsyncGenerator(dataResult)) {
                findingsArray = Array.isArray(finalEnriched?.findingsForDisplay)
                    ? finalEnriched.findingsForDisplay
                    : [];
            } else {
                findingsArray = Array.isArray(finalEnriched) ? finalEnriched : [];
                if (!Array.isArray(finalEnriched) && finalEnriched?.clusters) {
                    findingsArray = finalEnriched.clusters;
                } else if (!Array.isArray(finalEnriched) && finalEnriched?.findings) {
                    findingsArray = finalEnriched.findings;
                }
            }

            const issues: Issue[] = findingsArray.map((f: any) => ({
                ruleId: this.ruleId,
                ruleName: this.ruleName,
                severity: (this.ctx as any).severity || 'WARNING',
                message: '',
                fingerprint: f.fingerprint,
                metadata: {
                    impactScore: f.impactScore,
                    fingerprint: f.fingerprint,
                    // exposureAmount carries the numeric amount so that consumers
                    // (e.g. analysis-processor) can sum total exposure from structured
                    // data rather than regex-parsing the free-text report message.
                    exposureAmount: typeof f.amount?.toNumber === 'function'
                        ? f.amount.toNumber()
                        : Number(f.amount ?? 0),
                    currency: f.currency || 'USD',
                    ...f.metadata
                },
                entities: f.entities || f.items || []
            }));

            let report: string;
            if (this.isAsyncGenerator(dataResult)) {
                report = await this._reportStep(finalEnriched, this.ctx, finalNorm);
            } else {
                report = await this._reportStep(finalEnriched, this.ctx, finalNorm);
            }

            issues.forEach(issue => {
                issue.message = report;
            });

            logger.info(`Rule ${this.ruleId} executed successfully`, {
                realmId,
                durationMs: Date.now() - startTime,
                status: issues.length > 0 ? 'WARNING' : 'PASSED',
                issueCount: issues.length
            });

            return {
                status: issues.length > 0 ? 'WARNING' : 'PASSED',
                message: report,
                issues
            };

        } catch (error) {
            logger.error(`Rule ${this.ruleId} failed`, {
                realmId,
                durationMs: Date.now() - startTime,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    private isAsyncGenerator(obj: any): obj is AsyncGenerator<any> {
        return obj && typeof obj[Symbol.asyncIterator] === 'function';
    }

    static async checkSyncHealth(
        repo: BrandedRepository,
        realmId: RealmId,
        entities: string[],
        staleThresholdMs: number = 26 * 60 * 60 * 1000
    ): Promise<{ ok: boolean; message?: string; syncLogs: any[] }> {
        const syncLogs = await Promise.all(
            entities.map(entity =>
                repo.findSyncLogs({ realmId, entityTypes: [entity] })
                    .then(logs => logs[0] ?? null)
            )
        );

        for (let i = 0; i < syncLogs.length; i++) {
            const log = syncLogs[i];
            const entity = entities[i];

            if (!log || log.status !== 'COMPLETED') {
                return { ok: false, message: `Sync for ${entity} is missing or incomplete.`, syncLogs };
            }

            const isStale = (Date.now() - log.createdAt.getTime()) > staleThresholdMs;
            if (isStale) {
                return { ok: false, message: `Sync for ${entity} is stale (>26h).`, syncLogs };
            }
        }

        return { ok: true, syncLogs };
    }
}
