import { CloudBillingClient } from "@google-cloud/billing";
import { setGlobalOptions } from "firebase-functions/v2";
import { logger } from "firebase-functions/v2";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { budgetExceeded, parseNotification } from "./budget.js";

// All functions run in Frankfurt with at most one instance, so a bug or an
// attack can never scale up costs.
setGlobalOptions({ region: "europe-west3", maxInstances: 1 });

/** Pub/Sub topic the budget in Cloud Billing publishes to. */
export const BUDGET_TOPIC = "budget-alerts";

const billing = new CloudBillingClient();

/**
 * Cost brake: when the monthly budget is used up, detach the billing
 * account from this project. Firestore and Functions then stop working
 * until billing is linked again by hand in the console.
 *
 * Set the environment variable BUDGET_GUARD_DRY_RUN=true to only log.
 */
export const budgetGuard = onMessagePublished(BUDGET_TOPIC, async (event) => {
    const notification = parseNotification(event.data.message.data);
    logger.info("Budget notification", notification);

    if (!budgetExceeded(notification)) return;

    const projectId = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
    if (!projectId) {
        logger.error("Project id unknown, billing not changed");
        return;
    }
    const name = `projects/${projectId}`;

    const [info] = await billing.getProjectBillingInfo({ name });
    if (!info.billingEnabled) {
        logger.info("Billing already disabled");
        return;
    }

    if (process.env.BUDGET_GUARD_DRY_RUN === "true") {
        logger.warn("Budget exceeded, dry run: billing stays enabled");
        return;
    }

    await billing.updateProjectBillingInfo({
        name,
        projectBillingInfo: { billingAccountName: "" },
    });
    logger.warn(`Budget exceeded, billing disabled for ${projectId}`);
});
