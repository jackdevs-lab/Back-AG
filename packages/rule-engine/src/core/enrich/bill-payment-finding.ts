// core/enrich/bill-payment-finding.ts
import { Prisma } from '@qb-health/financial-model';
import { createHash } from 'crypto';
import { NormalizedBillPayment, NormalizedVendor, NormalizedRuleConfig } from '../normalize/bill-payment';

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

/**
 * Supported major currencies for exchange rate validation.
 * Extend this list based on your organization's operational currencies.
 */
export const MAJOR_CURRENCIES = new Set([
    'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'INR', 'SGD'
]);

/**
 * Acceptable exchange rate bounds for major currencies.
 * Prevents data entry errors (e.g., 100x typo) from silently propagating.
 */
export const EXCHANGE_RATE_BOUNDS = { min: 0.01, max: 100 };

/**
 * Default scoring configuration for risk calculation.
 * Can be overridden per-rule via NormalizedRuleConfig.
 */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
    highSeverityBase: -10,
    warningSeverityBase: -2,
    amountFactorDivisor: 10000,
    amountFactorCap: 2,
    fallbackConfidencePenalty: 0.5,
    standardConfidenceMultiplier: 1.0
};

// ============================================================================
// ENRICHED FINDING TYPE
// ============================================================================

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
            confidencePenalty: number; // Note: actually a multiplier; legacy name preserved for backward compat
        };
    };
}

// ============================================================================
// CURRENCY & AMOUNT ENRICHMENT
// ============================================================================

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
export function isValidCurrencyCode(code: string): boolean {
    return /^[A-Z]{3}$/.test(code);
}

/**
 * Validates exchange rate is within acceptable bounds for major currencies.
 * @param currency - Currency code being validated
 * @param rate - Exchange rate value to check
 * @returns true if rate is within bounds (or currency is non-major), false otherwise
 */
export function isValidExchangeRate(currency: string, rate: number): boolean {
    if (!MAJOR_CURRENCIES.has(currency)) return true;
    return rate >= EXCHANGE_RATE_BOUNDS.min && rate <= EXCHANGE_RATE_BOUNDS.max;
}

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
export function enrichCurrency(
    payment: NormalizedBillPayment,
    defaultExchangeRates: Record<string, number>
): CurrencyEnrichmentResult {
    const rawCurrency = payment.parsedRaw?.CurrencyRef?.value;

    // Validate and normalize currency code
    const currency = rawCurrency && isValidCurrencyCode(rawCurrency)
        ? rawCurrency
        : 'USD';

    // Warn if original currency was invalid
    if (rawCurrency && !isValidCurrencyCode(rawCurrency)) {
        console.warn(
            `[enrichCurrency] Invalid currency code "${rawCurrency}" for payment ${payment.qbId}; ` +
            `defaulting to USD. Expected ISO 4217 format (e.g., USD, EUR).`
        );
    }

    const rawRate = payment.parsedRaw?.ExchangeRate;
    let exchangeRate: number;
    let confidence: CurrencyEnrichmentResult['confidence'];

    // Priority 1: Use raw exchange rate if provided AND valid
    if (rawRate !== undefined) {
        if (isValidExchangeRate(currency, rawRate)) {
            exchangeRate = rawRate;
            confidence = 'exact';
        } else {
            console.warn(
                `[enrichCurrency] Exchange rate ${rawRate} for ${currency} outside bounds ` +
                `[${EXCHANGE_RATE_BOUNDS.min}, ${EXCHANGE_RATE_BOUNDS.max}]; ` +
                `falling back to default rate for payment ${payment.qbId}`
            );
            // Fall through to default rate lookup
            exchangeRate = defaultExchangeRates[currency] ?? 1;
            confidence = defaultExchangeRates[currency] ? 'estimated' : 'fallback_1:1';
        }
    }
    // Priority 2: Use configured default rate
    else if (defaultExchangeRates[currency] !== undefined) {
        exchangeRate = defaultExchangeRates[currency];
        confidence = 'estimated';
    }
    // Priority 3: Fallback to 1:1 with warning
    else {
        if (isValidCurrencyCode(currency)) {
            console.warn(
                `[enrichCurrency] No exchange rate configured for currency "${currency}"; ` +
                `using 1:1 fallback for payment ${payment.qbId}. ` +
                `Please add rate to defaultExchangeRates config.`
            );
        }
        exchangeRate = 1;
        confidence = 'fallback_1:1';
    }

    const homeAmount = payment.amount.mul(exchangeRate);
    return { currency, exchangeRate, confidence, homeAmount };
}

// ============================================================================
// VENDOR ENRICHMENT
// ============================================================================

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
export function enrichVendor(
    vendorId: string | null,
    vendorMap: Map<string, NormalizedVendor>
): VendorEnrichmentResult {
    if (!vendorId) {
        return { vendorName: 'Unknown Vendor', confidence: 'not_provided' };
    }

    const vendor = vendorMap.get(vendorId);
    if (!vendor) {
        return { vendorName: 'Unknown Vendor', confidence: 'vendor_inactive' };
    }

    return {
        vendorName: vendor.name,
        confidence: vendor.active ? 'verified' : 'vendor_inactive'
    };
}

// ============================================================================
// IDENTIFIER & AUDIT ENRICHMENT
// ============================================================================

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
export function generateFindingId(
    ruleId: string,
    qbId: string,
    compositeSnapshotId: string,
    manualSuffix: string = ''
): string {
    return createHash('sha256')
        .update(`${ruleId}:${qbId}:${compositeSnapshotId}${manualSuffix}`)
        .digest('hex');
}

// ============================================================================
// SCORING CONFIGURATION TYPE
// ============================================================================

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

// ============================================================================
// SCORE CONTRIBUTION CALCULATION
// ============================================================================

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
export function computeDecayedScore(
    rawImpactScore: number,
    existingIssue?: { createdAt: Date | string }
): number {
    if (!existingIssue?.createdAt) return rawImpactScore;
    
    const WEEKS_MS = 7 * 24 * 60 * 60 * 1000;
    const createdAt = new Date(existingIssue.createdAt);
    const weeksUnresolved = (Date.now() - createdAt.getTime()) / WEEKS_MS;
    
    // Score rises 10% per week unresolved (capped at 100)
    return Math.min(100, Math.round(rawImpactScore * Math.pow(1.1, weeksUnresolved)));
}

export function calculateScoreContribution(
    homeAmount: Prisma.Decimal,
    currencyConfidence: CurrencyEnrichmentResult['confidence'],
    severity: 'HIGH' | 'WARNING',
    scoringConfig: ScoringConfig = DEFAULT_SCORING_CONFIG
): {
    baseImpact: number;
    amountFactor: number;
    confidencePenalty: number; // Legacy name: actually represents confidenceMultiplier
} {
    const baseImpact = severity === 'HIGH'
        ? scoringConfig.highSeverityBase
        : scoringConfig.warningSeverityBase;

    const amountFactor = Math.min(
        homeAmount.toNumber() / scoringConfig.amountFactorDivisor,
        scoringConfig.amountFactorCap
    );

    const confidenceMultiplier = currencyConfidence === 'fallback_1:1'
        ? scoringConfig.fallbackConfidencePenalty
        : scoringConfig.standardConfidenceMultiplier;

    return {
        baseImpact,
        amountFactor,
        confidencePenalty: confidenceMultiplier // TODO(v2): rename to confidenceMultiplier for clarity
    };
}

// ============================================================================
// COMPOSITE ENRICHMENT
// ============================================================================

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
export function createEnrichedFinding(
    payment: NormalizedBillPayment,
    currencyEnrichment: CurrencyEnrichmentResult,
    vendorEnrichment: VendorEnrichmentResult,
    ruleId: string,
    ruleVersion: string,
    compositeSnapshotId: string,
    homeCurrency: string,
    thresholdCurrency: string, // ← Now parameterized, not hardcoded
    severity: 'HIGH' | 'WARNING',
    now: Date = new Date(),
    scoringConfig?: ScoringConfig
): EnrichedBillPaymentFinding {
    const findingId = generateFindingId(ruleId, payment.qbId, compositeSnapshotId);

    const scoreContribution = calculateScoreContribution(
        currencyEnrichment.homeAmount,
        currencyEnrichment.confidence,
        severity,
        scoringConfig
    );

    const transactionDate = payment.date
        ? new Date(payment.date).toISOString().split('T')[0]
        : 'N/A';

    return {
        id: payment.qbId,
        findingId,
        amount: payment.amount.toFixed(2),
        homeAmount: currencyEnrichment.homeAmount.toFixed(2),
        currency: currencyEnrichment.currency,
        currencyConfidence: currencyEnrichment.confidence,
        vendor: payment.vendorId,
        vendorName: vendorEnrichment.vendorName,
        vendorConfidence: vendorEnrichment.confidence,
        auditMetadata: {
            ruleVersion,
            dataSnapshotId: compositeSnapshotId,
            timestamp: now.toISOString(),
            transactionDate,
            homeCurrency,
            thresholdCurrency, // ← Now dynamically passed, ensuring consistency
            scoreContribution
        }
    };
}

// ============================================================================
// SEVERITY CALCULATION
// ============================================================================

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
export function calculateSeverity(
    totalHomeAmount: Prisma.Decimal,
    threshold: Prisma.Decimal
): SeverityResult {
    const isHigh = totalHomeAmount.gt(threshold);
    return {
        severity: isHigh ? 'HIGH' : 'WARNING',
        resultStatus: isHigh ? 'FAILED' : 'WARNING'
    };
}
