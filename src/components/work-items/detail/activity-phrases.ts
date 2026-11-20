/**
 * The Activity feed's phrase for each audit action an item's history holds
 * (`WORK_ITEM_*`, written by 2.2's usecases). A `Record` over the known
 * actions, and `tests/unit/work-items/activity-phrases.test.ts` reads every
 * `WORK_ITEM_` action literal the app layer writes and fails when one has no
 * phrase: an unmapped action would otherwise fall back to the generic
 * sentence silently (the 2.3 map's risk 21).
 *
 * Copied in idea from inflect-compliance
 * `src/components/controls-shared/PanelActivityFeed.tsx` (`ACTION_PHRASE`)
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e; the table is Islestone's.
 */

/** Actions that write an entry on the item's own history, and their catalogue keys. */
export const ACTIVITY_PHRASE = {
    WORK_ITEM_CREATED: 'activity.created',
    WORK_ITEM_UPDATED: 'activity.updated',
    WORK_ITEM_STATE_CHANGED: 'activity.stateChanged',
    WORK_ITEM_ASSIGNED: 'activity.assigned',
    WORK_ITEM_LABELS_CHANGED: 'activity.labelsChanged',
    WORK_ITEM_LINKED: 'activity.linked',
    WORK_ITEM_UNLINKED: 'activity.unlinked',
    WORK_ITEM_RELATION_ADDED: 'activity.relationAdded',
    WORK_ITEM_RELATION_REMOVED: 'activity.relationRemoved',
    WORK_ITEM_MOVED: 'activity.moved',
    WORK_ITEM_REORDERED: 'activity.reordered',
    WORK_ITEM_REPARENTED: 'activity.reparented',
    WORK_ITEM_DELETED: 'activity.deleted',
    WORK_ITEM_RESTORED: 'activity.restored',
    WORK_ITEM_WATCHER_ADDED: 'activity.watcherAdded',
    WORK_ITEM_WATCHER_REMOVED: 'activity.watcherRemoved',
    WORK_ITEM_WATCHERS_ADDED_FROM_LIST: 'activity.watchersAddedFromList',
    WORK_ITEM_CUSTOM_FIELD_SET: 'activity.customFieldSet',
    WORK_ITEM_CYCLE_CHANGED: 'activity.cycleChanged',
    WORK_ITEM_MILESTONE_CHANGED: 'activity.milestoneChanged',
    WORK_ITEM_WAITING_ON_CHANGED: 'activity.waitingOnChanged',
    WORK_ITEM_ANSWER_MARKED: 'activity.answerMarked',
    WORK_ITEM_ANSWER_CLEARED: 'activity.answerCleared',
    WORK_ITEM_MENTIONED: 'activity.mentioned',
    WORK_ITEM_MENTIONS_REMOVED: 'activity.mentionsRemoved',
    // Review steps (2.8a).
    WORK_ITEM_REVIEW_STEPS_CHANGED: 'activity.reviewStepsChanged',
    WORK_ITEM_REVIEW_ROUND_STARTED: 'activity.reviewRoundStarted',
    WORK_ITEM_REVIEW_STEP_OPENED: 'activity.reviewStepOpened',
    WORK_ITEM_REVIEW_RESPONDED: 'activity.reviewResponded',
    WORK_ITEM_REVIEW_RESPONSE_CHANGED: 'activity.reviewResponseChanged',
    WORK_ITEM_REVIEW_STEP_SKIPPED: 'activity.reviewStepSkipped',
    WORK_ITEM_REVIEW_ROUND_ENDED: 'activity.reviewRoundEnded',
    WORK_ITEM_REVIEWERS_CHANGED: 'activity.reviewersChanged',
    WORK_ITEM_REVIEWER_WITHDRAWN: 'activity.reviewerWithdrawn',
} as const;

/**
 * `WORK_ITEM_` actions that never reach an item's Activity: they are written
 * on another entity (a type), or once per workspace (the purge, a counts-only
 * entry), or are a notification kind rather than an audit action.
 */
export const NOT_ITEM_ACTIVITY: ReadonlySet<string> = new Set([
    'WORK_ITEM_TYPE_CREATED',
    'WORK_ITEM_TYPE_UPDATED',
    'WORK_ITEM_PURGED',
    'WORK_ITEM_DUE',
    'WORK_ITEM_WATCH_UPDATE',
    'WORK_ITEM_WAITING_ON',
    'WORK_ITEM_TYPE_FIELD_SET',
    'WORK_ITEM_TYPE_REVIEW_STEPS_SET',
    // Review steps (2.8a): notification kinds, and member removal's counts-only entry.
    'WORK_ITEM_REVIEW_REQUESTED',
    'WORK_ITEM_REVIEW_DUE',
    'WORK_ITEM_REVIEW_RETURNED',
    'WORK_ITEM_REVIEW_COMPLETED',
    'WORK_ITEM_REVIEWERS_WITHDRAWN_ON_MEMBER_REMOVAL',
]);

export function activityPhraseKey(action: string | undefined): string {
    return (action && (ACTIVITY_PHRASE as Record<string, string>)[action]) || 'activity.changed';
}
