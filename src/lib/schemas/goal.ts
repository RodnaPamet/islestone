/**
 * Request schemas for goals and initiatives (sub-phase 3.2a;
 * docs/porting/maps/3.2.md, "Usecases, routes and keys"). Every body is
 * `.strict()`; due dates are date-only (`YYYY-MM-DD`), never passed through a
 * time zone. Titles, names and descriptions are sanitised by the usecases
 * (`sanitizePlainText`) before they are stored.
 */
import { z } from 'zod';

import { DateOnly } from '@/lib/schemas/work-item';

const Id = z.string().min(1).max(64);

/** A goal's title, an outcome stated as a sentence (CHECK 1..200). */
export const GOAL_TITLE_MAX = 200;
/** An initiative's name, like a project's (CHECK 1..120). */
export const INITIATIVE_NAME_MAX = 120;
/** A description's longest length before encryption. */
export const GOAL_DESCRIPTION_MAX = 10_000;

export const GOAL_STATUSES = ['PLANNED', 'STARTED', 'COMPLETED', 'CANCELLED'] as const;
export const INITIATIVE_STATUSES = GOAL_STATUSES;
export const HEALTH_VALUES = ['ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'COMPLETED'] as const;

const Description = z.string().max(GOAL_DESCRIPTION_MAX);

export const CreateGoalSchema = z
    .object({
        title: z.string().min(1).max(GOAL_TITLE_MAX),
        description: Description.nullish(),
        parentId: Id.nullish(),
        status: z.enum(GOAL_STATUSES).optional(),
        dueDate: DateOnly.nullish(),
        leadUserId: Id.nullish(),
    })
    .strict();

export const UpdateGoalSchema = z
    .object({
        title: z.string().min(1).max(GOAL_TITLE_MAX).optional(),
        description: Description.nullable().optional(),
        parentId: Id.nullable().optional(),
        status: z.enum(GOAL_STATUSES).optional(),
        dueDate: DateOnly.nullable().optional(),
        leadUserId: Id.nullable().optional(),
    })
    .strict();

export const CreateInitiativeSchema = z
    .object({
        name: z.string().min(1).max(INITIATIVE_NAME_MAX),
        description: Description.nullish(),
        goalId: Id.nullish(),
        status: z.enum(INITIATIVE_STATUSES).optional(),
        dueDate: DateOnly.nullish(),
        leadUserId: Id.nullish(),
    })
    .strict();

export const UpdateInitiativeSchema = z
    .object({
        name: z.string().min(1).max(INITIATIVE_NAME_MAX).optional(),
        description: Description.nullable().optional(),
        goalId: Id.nullable().optional(),
        status: z.enum(INITIATIVE_STATUSES).optional(),
        dueDate: DateOnly.nullable().optional(),
        leadUserId: Id.nullable().optional(),
    })
    .strict();

export const SetArchivedSchema = z.object({ archived: z.boolean() }).strict();

/** The goals and initiatives lists' query (`GET /goals`, `GET /initiatives`). */
export const GoalListQuerySchema = z
    .object({
        status: z.string().max(200).optional(),
        archived: z.enum(['true', 'false']).optional(),
        deleted: z.enum(['true', 'false']).optional(),
        leadUserId: Id.optional(),
        health: z.string().max(200).optional(),
        goalId: Id.optional(),
    })
    .strict();

export const SetProjectInitiativeSchema = z.object({ initiativeId: Id.nullable() }).strict();

export const SetWorkItemGoalSchema = z.object({ goalId: Id.nullable() }).strict();
