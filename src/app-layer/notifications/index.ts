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
    isInAppTypeEnabled,
    memberDeliveries,
    emailDeliveryFor,
    getOutboxStats,
    type TenantNotificationSettingsData,
    type OutboxStats,
} from './settings';
export {
    buildWorkItemAssignedEmail,
    buildWorkItemWaitingOnEmail,
    buildNotificationDigestEmail,
    type EmailTemplateResult,
    type WorkItemAssignedPayload,
    type WorkItemWaitingOnPayload,
    type NotificationDigestPayload,
} from './templates';
