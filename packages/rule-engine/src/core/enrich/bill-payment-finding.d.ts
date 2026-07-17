import { Prisma } from '@qb-health/financial-model';
import { NormalizedBillPayment, NormalizedVendor } from '../normalize/bill-payment';
/**
 * Supported major currencies for exchange rate validation.
 * Extend this list based on your organization's operational currencies.
 */
export declare const MAJOR_CURRENCIES: Set<string>;
/**
 * Acceptable exchange rate bounds for major currencies.
 * Prevents data entry errors (e.g., 100x typo) from silently propagating.
 */
export declare const EXCHANGE_RATE_BOUNDS: {
    min: number;
    max: number;
};
/**
 * Default scoring configuration for risk calculation.
 * Can be overridden per-rule via NormalizedRuleConfig.
 */
export declare const DEFAULT_SCORING_CONFIG: ScoringConfig;
export interface EnrichedBillPaymentFinding {
    id: string;
    findingId: string;
    amount: string;
    homeAmount: string;
    currency: string;
    currencyConfidence: 'exact' | 'estimated' | 'fallback_1:1';
    vendor: string | null;
    vendorName: string;
    vendorConfidence: 'verified' | 'vendor_inactive' | 'not_provided';
    auditMetadata: {
        ruleVersion: string;
        dataSnapshotId: string;
        timestamp: string;
        transactionDate: string;
        homeCurrency: string;
        thresholdCurrency: string;
        scoreContribution: {
            baseImpact: number;
            amountFactor: number;
            confidencePenalty: number;
        };
    };
}
export interface CurrencyEnrichmentResult {
    currency: string;
    exchangeRate: number;
    confidence: 'exact' | 'estimated' | 'fallback_1:1';
    homeAmount: Prisma.Decimal;
}
/**
 * Validates ISO 4217 currency code format (3 uppercase letters).
 * @param code - Currency code to validate
 * @returns true if valid format, false otherwise
 */
export declare function isValidCurrencyCode(code: string): boolean;
/**
 * Validates exchange rate is within acceptable bounds for major currencies.
 * @param currency - Currency code being validated
 * @param rate - Exchange rate value to check
 * @returns true if rate is within bounds (or currency is non-major), false otherwise
 */
export declare function isValidExchangeRate(currency: string, rate: number): boolean;
/**
 * Enriches payment with currency conversion logic.
 * Applies exchange rate hierarchy: raw > config default > 1:1 fallback.
 *
 * Guardrails:
 * - Rejects malformed currency codes (non-ISO-4217 format)
 * - Validates exchange rates for major currencies against [0.01, 100] bounds
 * - Logs warnings for fallback scenarios to aid auditability
 *
 * @param payment - Normalized bill payment with raw currency/exchange data
 * @param defaultExchangeRates - Map of currency codes to default exchange rates
 * @returns CurrencyEnrichmentResult with converted amount and confidence level
 */
export declare function enrichCurrency(payment: NormalizedBillPayment, defaultExchangeRates: Record<string, number>): CurrencyEnrichmentResult;
export interface VendorEnrichmentResult {
    vendorName: string;
    confidence: 'verified' | 'vendor_inactive' | 'not_provided';
}
/**
 * Enriches payment with vendor information and confidence scoring.
 * Handles missing/inactive vendors gracefully.
 *
 * @param vendorId - Vendor identifier from payment data
 * @param vendorMap - Lookup map of vendor IDs to NormalizedVendor objects
 * @returns VendorEnrichmentResult with name and confidence level
 */
export declare function enrichVendor(vendorId: string | null, vendorMap: Map<string, NormalizedVendor>): VendorEnrichmentResult;
/**
 * Generates deterministic finding ID with snapshot context.
 * Supports manual trigger suffix for traceability.
 *
 * @param ruleId - Identifier of the rule that generated this finding
 * @param qbId - QuickBooks transaction ID
 * @param compositeSnapshotId - Data snapshot identifier for reproducibility
 * @param manualSuffix - Optional suffix for manual re-runs (e.g., "_retry_1")
 * @returns SHA-256 hex string unique to this finding context
 */
export declare function generateFindingId(ruleId: string, qbId: string, compositeSnapshotId: string, manualSuffix?: string): string;
/**
 * Configuration for risk score contribution calculation.
 * Allows per-rule customization of scoring weights and thresholds.
 */
export interface ScoringConfig {
    /** Base impact value for HIGH severity findings (typically negative) */
    highSeverityBase: number;
    /** Base impact value for WARNING severity findings */
    warningSeverityBase: number;
    /** Divisor for amount-based scaling: amountFactor = min(amount/divisor, cap) */
    amountFactorDivisor: number;
    /** Maximum value for amountFactor to prevent outlier dominance */
    amountFactorCap: number;
    /** Multiplier applied when currency confidence is fallback_1:1 (reduces impact) */
    fallbackConfidencePenalty: number;
    /** Multiplier applied for exact/estimated confidence (typically 1.0) */
    standardConfidenceMultiplier: number;
}
/**
 * Calculates score contribution factors for risk scoring.
 *
 * Scoring Formula:
 * ```
 * adjustedImpact = baseImpact × confidenceMultiplier
 * totalContribution = adjustedImpact + amountFactor
 * ```
 *
 * Where:
 * - `baseImpact`: Severity-dependent base value from config
 * - `confidenceMultiplier`: Reduces impact when currency data is uncertain
 * - `amountFactor`: Scales with transaction size (capped to prevent outliers)
 *
 * Example with defaults:
 * - HIGH severity, $50k amount, fallback confidence:
 *   baseImpact = -10, confidenceMultiplier = 0.5, amountFactor = min(50000/10000, 2) = 2
 *   → adjustedImpact = -10 × 0.5 = -5
 *   → totalContribution = -5 + 2 = -3
 *
 * @param homeAmount - Transaction amount in home currency (Decimal for precision)
 * @param currencyConfidence - Confidence level of currency conversion
 * @param severity - Rule severity level (HIGH or WARNING)
 * @param scoringConfig - Optional config override; uses DEFAULT_SCORING_CONFIG if omitted
 * @returns Object with individual scoring components for auditability
 */
/**
 * Calculates decayed impact score based on how long the issue has remained unresolved.
 * The score rises 10% per week unresolved, capped at 100.
 */
export declare function computeDecayedScore(rawImpactScore: number, existingIssue?: {
    createdAt: Date | string;
}): number;
export declare function calculateScoreContribution(homeAmount: Prisma.Decimal, currencyConfidence: CurrencyEnrichmentResult['confidence'], severity: 'HIGH' | 'WARNING', scoringConfig?: ScoringConfig): {
    baseImpact: number;
    amountFactor: number;
    confidencePenalty: number;
};
/**
 * Creates fully enriched finding from normalized payment and context.
 * Orchestrates all enrichment steps into single, reusable function.
 *
 * @param payment - Normalized bill payment data
 * @param currencyEnrichment - Pre-computed currency conversion result
 * @param vendorEnrichment - Pre-computed vendor lookup result
 * @param ruleId - Identifier of the triggering rule
 * @param ruleVersion - Version string of the rule for audit trail
 * @param compositeSnapshotId - Snapshot ID for data reproducibility
 * @param homeCurrency - Base currency for amount conversion (e.g., USD)
 * @param thresholdCurrency - Currency in which rule thresholds are defined
 * @param severity - Calculated severity level (HIGH/WARNING)
 * @param now - Timestamp for audit metadata (defaults to current time)
 * @param scoringConfig - Optional scoring configuration override
 * @returns Fully populated EnrichedBillPaymentFinding ready for persistence
 */
export declare function createEnrichedFinding(payment: NormalizedBillPayment, currencyEnrichment: CurrencyEnrichmentResult, vendorEnrichment: VendorEnrichmentResult, ruleId: string, ruleVersion: string, compositeSnapshotId: string, homeCurrency: string, thresholdCurrency: string, // ← Now parameterized, not hardcoded
severity: 'HIGH' | 'WARNING', now?: Date, scoringConfig?: ScoringConfig): EnrichedBillPaymentFinding;
export interface SeverityResult {
    severity: 'HIGH' | 'WARNING';
    resultStatus: 'FAILED' | 'WARNING';
}
/**
 * Determines final severity based on total home currency amount vs threshold.
 * Uses Decimal-safe comparison to avoid floating-point errors.
 *
 * @param totalHomeAmount - Aggregated transaction amount in home currency
 * @param threshold - Rule-defined threshold in thresholdCurrency
 * @returns SeverityResult with severity level and status flag
 */
export declare function calculateSeverity(totalHomeAmount: Prisma.Decimal, threshold: Prisma.Decimal): SeverityResult;
