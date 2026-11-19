/**
 * Email notification service barrel exports.
 *
 * Copied from inflect-compliance `src/app-layer/notifications/index.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, over Islestone's templates; the
 * leaver exports are not ported.
 */
export { enqueueEmail, buildDedupeKey, type EnqueueEmailInput } from './enqueue';
export { processOutbox, type ProcessOutboxOptions, type ProcessOutboxResult } from './processOutbox';
export {
    getTenantNotificationSettings,
    updateTenantNotificationSettings,
    isNotificationsEnabled,
    getOutboxStats,
    type TenantNotificationSettingsData,
    type OutboxStats,
} from './settings';
export {
    buildWorkItemAssignedEmail,
    buildDueDigestEmail,
    type EmailTemplateResult,
    type WorkItemAssignedPayload,
    type DueDigestPayload,
    type DigestAudience,
} from './templates';
export {
    dispatchDigest,
    buildDigestDedupeKey,
    type DigestCategory,
    type DispatchDigestOptions,
    type DispatchDigestResult,
} from './digest-dispatcher';
