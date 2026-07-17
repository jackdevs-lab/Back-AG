import { Prisma } from '@qb-health/financial-model';
import { RuleContext, RuleExecutionResult } from '../src/types';
export interface PipelineStep<TInput, TOutput> {
    (input: TInput): Promise<TOutput> | TOutput;
}
/**
 * Standardized Runner for diagnostic rule pipelines.
 * Orchestrates: Data -> Normalization -> Detection -> Enrichment -> Reporting.
 */
export declare class PipelineRunner {
    /**
     * Executes a standardized pre-flight check for sync health.
     */
    static checkSyncHealth(prisma: Prisma.Client, realmId: string, entities: string[], staleThresholdMs?: number): Promise<{
        ok: boolean;
        message?: string;
        syncLogs: any[];
    }>;
    /**
     * Safely wraps the execution of a rule pipeline with standard error handling and telemetry.
     */
    static run<TResult>(ctx: RuleContext, ruleId: string, logic: () => Promise<RuleExecutionResult>): Promise<RuleExecutionResult>;
}
