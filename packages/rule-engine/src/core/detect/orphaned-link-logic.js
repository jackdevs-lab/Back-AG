"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectOrphanedBillLinks = detectOrphanedBillLinks;
// core/detect/orphaned-link-logic.ts
const financial_model_1 = require("@qb-health/financial-model");
/**
 * Pure logic to identify orphaned bill payment references.
 * @param payments List of payments with their parsed lines.
 * @param existingBillIds Set of all valid Bill QBIDs in the current context.
 * @returns Array of orphaned links.
 */
function detectOrphanedBillLinks(payments, existingBillIds) {
    const orphaned = [];
    for (const payment of payments) {
        const raw = payment.parsedRaw;
        if (!raw || !raw.Line)
            continue;
        for (const line of raw.Line) {
            if (!line.LinkedTxn)
                continue;
            for (const link of line.LinkedTxn) {
                if (link.TxnType === 'Bill' &&
                    link.TxnId &&
                    !existingBillIds.has(link.TxnId)) {
                    orphaned.push({
                        paymentId: payment.qbId,
                        missingBillId: link.TxnId,
                        amount: new financial_model_1.Prisma.Decimal(line.Amount || 0)
                    });
                }
            }
        }
    }
    return orphaned;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3JwaGFuZWQtbGluay1sb2dpYy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm9ycGhhbmVkLWxpbmstbG9naWMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFlQSwwREF5Q0M7QUF4REQscUNBQXFDO0FBQ3JDLGdFQUFvRDtBQVFwRDs7Ozs7R0FLRztBQUNILFNBQWdCLHVCQUF1QixDQUNuQyxRQVdFLEVBQ0YsZUFBNEI7SUFFNUIsTUFBTSxRQUFRLEdBQW1CLEVBQUUsQ0FBQztJQUVwQyxLQUFLLE1BQU0sT0FBTyxJQUFJLFFBQVEsRUFBRSxDQUFDO1FBQzdCLE1BQU0sR0FBRyxHQUFHLE9BQU8sQ0FBQyxTQUFTLENBQUM7UUFDOUIsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJO1lBQUUsU0FBUztRQUVoQyxLQUFLLE1BQU0sSUFBSSxJQUFJLEdBQUcsQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUMxQixJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVM7Z0JBQUUsU0FBUztZQUU5QixLQUFLLE1BQU0sSUFBSSxJQUFJLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztnQkFDaEMsSUFDSSxJQUFJLENBQUMsT0FBTyxLQUFLLE1BQU07b0JBQ3ZCLElBQUksQ0FBQyxLQUFLO29CQUNWLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQ2xDLENBQUM7b0JBQ0MsUUFBUSxDQUFDLElBQUksQ0FBQzt3QkFDVixTQUFTLEVBQUUsT0FBTyxDQUFDLElBQUk7d0JBQ3ZCLGFBQWEsRUFBRSxJQUFJLENBQUMsS0FBSzt3QkFDekIsTUFBTSxFQUFFLElBQUksd0JBQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDLENBQUM7cUJBQy9DLENBQUMsQ0FBQztnQkFDUCxDQUFDO1lBQ0wsQ0FBQztRQUNMLENBQUM7SUFDTCxDQUFDO0lBRUQsT0FBTyxRQUFRLENBQUM7QUFDcEIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIGNvcmUvZGV0ZWN0L29ycGhhbmVkLWxpbmstbG9naWMudHNcbmltcG9ydCB7IFByaXNtYSB9IGZyb20gJ0BxYi1oZWFsdGgvZmluYW5jaWFsLW1vZGVsJztcblxuZXhwb3J0IGludGVyZmFjZSBPcnBoYW5lZExpbmsge1xuICAgIHBheW1lbnRJZDogc3RyaW5nO1xuICAgIG1pc3NpbmdCaWxsSWQ6IHN0cmluZztcbiAgICBhbW91bnQ6IFByaXNtYS5EZWNpbWFsO1xufVxuXG4vKipcbiAqIFB1cmUgbG9naWMgdG8gaWRlbnRpZnkgb3JwaGFuZWQgYmlsbCBwYXltZW50IHJlZmVyZW5jZXMuXG4gKiBAcGFyYW0gcGF5bWVudHMgTGlzdCBvZiBwYXltZW50cyB3aXRoIHRoZWlyIHBhcnNlZCBsaW5lcy5cbiAqIEBwYXJhbSBleGlzdGluZ0JpbGxJZHMgU2V0IG9mIGFsbCB2YWxpZCBCaWxsIFFCSURzIGluIHRoZSBjdXJyZW50IGNvbnRleHQuXG4gKiBAcmV0dXJucyBBcnJheSBvZiBvcnBoYW5lZCBsaW5rcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRldGVjdE9ycGhhbmVkQmlsbExpbmtzKFxuICAgIHBheW1lbnRzOiBBcnJheTx7XG4gICAgICAgIHFiSWQ6IHN0cmluZztcbiAgICAgICAgcGFyc2VkUmF3OiB7XG4gICAgICAgICAgICBMaW5lPzogQXJyYXk8e1xuICAgICAgICAgICAgICAgIEFtb3VudD86IGFueTtcbiAgICAgICAgICAgICAgICBMaW5rZWRUeG4/OiBBcnJheTx7XG4gICAgICAgICAgICAgICAgICAgIFR4blR5cGU/OiBzdHJpbmc7XG4gICAgICAgICAgICAgICAgICAgIFR4bklkPzogc3RyaW5nO1xuICAgICAgICAgICAgICAgIH0+O1xuICAgICAgICAgICAgfT47XG4gICAgICAgIH0gfCBudWxsO1xuICAgIH0+LFxuICAgIGV4aXN0aW5nQmlsbElkczogU2V0PHN0cmluZz5cbik6IE9ycGhhbmVkTGlua1tdIHtcbiAgICBjb25zdCBvcnBoYW5lZDogT3JwaGFuZWRMaW5rW10gPSBbXTtcblxuICAgIGZvciAoY29uc3QgcGF5bWVudCBvZiBwYXltZW50cykge1xuICAgICAgICBjb25zdCByYXcgPSBwYXltZW50LnBhcnNlZFJhdztcbiAgICAgICAgaWYgKCFyYXcgfHwgIXJhdy5MaW5lKSBjb250aW51ZTtcblxuICAgICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgcmF3LkxpbmUpIHtcbiAgICAgICAgICAgIGlmICghbGluZS5MaW5rZWRUeG4pIGNvbnRpbnVlO1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGxpbmsgb2YgbGluZS5MaW5rZWRUeG4pIHtcbiAgICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgICAgIGxpbmsuVHhuVHlwZSA9PT0gJ0JpbGwnICYmIFxuICAgICAgICAgICAgICAgICAgICBsaW5rLlR4bklkICYmIFxuICAgICAgICAgICAgICAgICAgICAhZXhpc3RpbmdCaWxsSWRzLmhhcyhsaW5rLlR4bklkKVxuICAgICAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgICAgICBvcnBoYW5lZC5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHBheW1lbnRJZDogcGF5bWVudC5xYklkLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWlzc2luZ0JpbGxJZDogbGluay5UeG5JZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGFtb3VudDogbmV3IFByaXNtYS5EZWNpbWFsKGxpbmUuQW1vdW50IHx8IDApXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBvcnBoYW5lZDtcbn1cbiJdfQ==