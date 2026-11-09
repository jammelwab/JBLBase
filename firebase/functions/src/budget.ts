/**
 * Budget notification as sent by Cloud Billing to Pub/Sub.
 * https://cloud.google.com/billing/docs/how-to/budgets-programmatic-notifications
 */
export interface BudgetNotification {
    budgetDisplayName?: string;
    costAmount?: number;
    costIntervalStart?: string;
    budgetAmount?: number;
    budgetAmountType?: string;
    alertThresholdExceeded?: number;
    currencyCode?: string;
}

/** Parses the base64 JSON payload of a Pub/Sub message. */
export function parseNotification(base64: string | undefined): BudgetNotification | null {
    if (!base64) return null;
    try {
        const parsed: unknown = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
        return parsed && typeof parsed === "object" ? (parsed as BudgetNotification) : null;
    } catch {
        return null;
    }
}

/**
 * True when the costs of the current period reached the budget. Then the
 * billing account is detached from the project and paid services stop.
 */
export function budgetExceeded(n: BudgetNotification | null): boolean {
    if (!n) return false;
    const cost = n.costAmount;
    const budget = n.budgetAmount;
    if (typeof cost !== "number" || typeof budget !== "number") return false;
    if (!Number.isFinite(cost) || !Number.isFinite(budget) || budget <= 0) return false;
    return cost >= budget;
}
