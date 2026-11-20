/**
 * The automation bus's emit seam, stubbed until sub-phase 5.1 builds the
 * engine (docs/porting/maps/2.1-2.2.md, import closure).
 *
 * The typed event contracts live here so 5.1 replaces only the body of
 * `emitAutomationEvent`: the data types already carry the fields 5.1's
 * `CREATE_WORK_ITEM`, `SET_FIELD`, `ASSIGN` and `ADD_COMMENT` arms read, and
 * `automationDepth` comes from the context so a rule that sets a state cannot
 * re-trigger itself without bound. Every call site is where inflect-compliance
 * has it (create: inside the transaction; a state change: after the commit),
 * so the order tests already bite when the body becomes real.
 *
 * Must not import `jobs/` or BullMQ: a usecase importing it would drag the job
 * graph into the request path.
 *
 * Written fresh for Islestone from inflect-compliance's
 * `src/app-layer/automation/event-contracts.ts` (`TASK_CREATED`,
 * `TASK_STATUS_CHANGED`) at 5528464fc54a8681956f3b9ce23ca9c075f0420e,
 * renamed and without `controlId`, `severity` or a type string.
 */
import type { WorkflowStateCategory, WorkItemPriority } from '@prisma/client';

import { logger } from '@/lib/observability/logger';
import type { RequestContext } from '../types';

export interface WorkItemCreatedData {
    key: string;
    title: string;
    projectId: string;
    teamId: string;
    typeId: string;
    stateId: string;
    stateCategory: WorkflowStateCategory;
    priority: WorkItemPriority;
    assigneeId: string | null;
    parentId: string | null;
}

/**
 * An intake request arrived or was decided (sub-phase 2.6a; 5.1 defines the
 * contract "for … intake"). Ids and codes only: never a title, text or name.
 */
export interface IntakeRequestEventData {
    projectId: string;
    channel: 'INTERNAL_FORM' | 'PUBLIC_FORM' | 'EMAIL';
    status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'MERGED';
    formId: string | null;
    workItemId: string | null;
    declineReason: string | null;
}

export interface WorkItemStateChangedData {
    key: string;
    fromStateId: string;
    toStateId: string;
    fromCategory: WorkflowStateCategory;
    toCategory: WorkflowStateCategory;
    teamId: string;
    projectId: string;
}

export type AutomationEventInput =
    | {
          event: 'WORK_ITEM_CREATED';
          entityType: 'WorkItem';
          entityId: string;
          actorUserId: string;
          stableKey: string;
          data: WorkItemCreatedData;
      }
    | {
          event: 'WORK_ITEM_STATE_CHANGED';
          entityType: 'WorkItem';
          entityId: string;
          actorUserId: string;
          stableKey: string;
          data: WorkItemStateChangedData;
      }
    | {
          event: 'INTAKE_REQUEST_RECEIVED' | 'INTAKE_REQUEST_DECIDED';
          entityType: 'IntakeRequest';
          entityId: string;
          actorUserId: string;
          stableKey: string;
          data: IntakeRequestEventData;
      };

/** A no-op that logs at debug until sub-phase 5.1 (the rule engine). */
export async function emitAutomationEvent(ctx: RequestContext, e: AutomationEventInput): Promise<void> {
    logger.debug('automation event (no rule engine before 5.1)', {
        component: 'automation',
        event: e.event,
        entityId: e.entityId,
        tenantId: ctx.tenantId,
    });
}
