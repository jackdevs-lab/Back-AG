/**
 * QuickBooks Online deep link builder.
 *
 * Host differs per environment:
 *   sandbox    -> https://sandbox.qbo.intuit.com
 *   production -> https://qbo.intuit.com
 *
 * Resolved once at module load from QB_ENVIRONMENT so the same rule code
 * works in staging and production without per-rule branching.
 */

const QBO_WEB_BASE =
    process.env.QB_ENVIRONMENT?.toLowerCase() === 'sandbox'
        ? 'https://sandbox.qbo.intuit.com'
        : 'https://qbo.intuit.com';

/**
 * QBO web app entity path segments. These are the segments QBO uses in its
 * web UI (not the API entity names — note "recvpayment" and "billpayment",
 * "customerdetail").
 */
export type QboDeepLinkEntity =
    | 'txndetail'
    | 'expense'
    | 'check'
    | 'invoice'
    | 'bill'
    | 'billpayment'
    | 'recvpayment'
    | 'vendorcredit'
    | 'creditmemo'
    | 'journal'
    | 'deposit'
    | 'estimate'
    | 'salesreceipt'
    | 'purchase'
    | 'transfer';

/**
 * Standard transaction deep link: /app/{entity}?realmId=...&txnId=...
 * Used by invoice, bill, billpayment, recvpayment, vendorcredit, creditmemo, etc.
 */
export function buildQboDeepLink(
    entity: QboDeepLinkEntity,
    realmId: string,
    txnId: string
): string {
    return `${QBO_WEB_BASE}/app/${entity}?realmId=${realmId}&txnId=${txnId}`;
}

/**
 * Customer/vendor detail page uses `nameId` instead of `txnId`.
 * Used by customer-credit-no-invoices and negative-ar-balance.
 */
export function buildQboNameDeepLink(
    realmId: string,
    nameId: string
): string {
    return `${QBO_WEB_BASE}/app/customerdetail?realmId=${realmId}&nameId=${nameId}`;
}