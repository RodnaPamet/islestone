/**
 * One seeded workspace, configuration through the application's own code
 * (Hardening H2a; docs/porting/maps/H2.md part 1.1; owner decision 171).
 *
 * The workspace, its owner and their first membership are the bootstrap
 * registration performs (`/api/auth/register`: tenant with its wrapped data
 * key, user, OWNER membership, one transaction), and member accounts are the
 * accounts registration makes; everything after that goes through the
 * usecases as a real member would: invitations and their redemption, teams
 * (with their workflow), projects, labels, custom fields and their options,
 * milestones, the cycles from today on, and later the 1 % item sample. Cycles
 * that ended before today cannot be made by the usecase (a new cycle must end
 * today or later), so the bulk writer adds those, completed.
 */
import type { PrismaClient, Role, WorkflowStateCategory } from '@prisma/client';

import { resolveMemberContext } from '../../src/app-layer/context-system';
import type { RequestContext } from '../../src/app-layer/types';
import { createCustomField } from '../../src/app-layer/usecases/custom-field';
import { createCycle } from '../../src/app-layer/usecases/cycle';
import { createLabel } from '../../src/app-layer/usecases/label';
import { createMilestone } from '../../src/app-layer/usecases/milestone';
import { createProject } from '../../src/app-layer/usecases/project';
import { createTeam } from '../../src/app-layer/usecases/team';
import { createInviteToken, redeemInvite } from '../../src/app-layer/usecases/tenant-invites';
import { listWorkItemTypes } from '../../src/app-layer/usecases/work-item-type';
import { addTeamHolidays, addWorkspaceHolidays, setTeamWorkingCalendar, setWorkspaceWorkingCalendar } from '../../src/app-layer/usecases/working-calendar';
import { lookupEmail } from '../../src/lib/auth/email-lookup';
import { hashPassword } from '../../src/lib/auth/passwords';
import { prisma } from '../../src/lib/prisma';
import { hashForLookup } from '../../src/lib/security/encryption';
import { generateAndWrapDek } from '../../src/lib/security/tenant-keys';

import { FIELD_DEFS } from './plan';
import type { Rng } from './random';
import { stream } from './random';
import { prefixFor, RATIOS, type Shape } from './shapes';
import { BULGARIAN_WORDS, ENGLISH_WORDS } from './words';

/**
 * The password of the two seeded accounts that sign in (the owner and the
 * heavy member, for H2b's harness): a throwaway value on a throwaway database.
 */
export const SEED_PASSWORD = 'seed-scale-perf-2026'; // pragma: allowlist secret — a seeded test account on a disposable database

export const DAY_MS = 86_400_000;

export interface SeedMember {
    userId: string;
    email: string;
    role: Role;
    /** May be assigned and may write (MEMBER, ADMIN, OWNER). */
    writer: boolean;
}

export interface SeedState {
    id: string;
    category: WorkflowStateCategory;
}

export interface SeedTeam {
    id: string;
    states: Record<string, SeedState>;
    /** Fortnightly windows, oldest first; `id` set once the cycle exists. */
    cycles: Array<{ id: string | null; startsOn: string; endsOn: string; past: boolean }>;
}

export interface SeedField {
    id: string;
    type: (typeof FIELD_DEFS)[number]['type'];
    /** Option ids in the definition's order (SELECT only). */
    options: string[];
}

export interface SeedProject {
    id: string;
    keyPrefix: string;
    teamId: string;
    size: number;
    fields: SeedField[];
    milestones: string[];
}

export interface SeedWorkspace {
    tenantId: string;
    slug: string;
    owner: RequestContext;
    /** Every member, the heavy member first; Zipf ranks follow this order among writers. */
    members: SeedMember[];
    writers: SeedMember[];
    teams: SeedTeam[];
    typeIds: string[];
    labelIds: string[];
    projects: SeedProject[];
}

export interface SeedEnv {
    seed: string;
    /** UTC midnight of the run day. */
    anchor: Date;
    log: (line: string) => void;
}

export function dayKey(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/** The role of the k-th invited member (the owner is not invited). */
function roleFor(k: number, total: number): Role {
    if (k === 1 || k === 2) return 'ADMIN';
    // About one in twelve reads only.
    if (k >= 3 && k % 12 === 0 && k < total) return 'VIEWER';
    return 'MEMBER';
}

/** The fortnightly windows of a team: half end before the anchor, the rest from the week of it. */
function cycleWindows(anchor: Date): SeedTeam['cycles'] {
    const half = Math.floor(RATIOS.cycles / 2);
    const first = new Date(anchor.getTime() - (half * 14 + 7) * DAY_MS);
    return Array.from({ length: RATIOS.cycles }, (_, i) => {
        const start = new Date(first.getTime() + i * 14 * DAY_MS);
        const end = new Date(start.getTime() + 13 * DAY_MS);
        return { id: null, startsOn: dayKey(start), endsOn: dayKey(end), past: i < half };
    });
}

/** Twelve holidays a month apart, from six months before the day to six after. */
function holidaysAround(day: Date, name: string): Array<{ day: string; name: string }> {
    return Array.from({ length: 12 }, (_, i) => ({ day: dayKey(new Date(day.getTime() + (i - 6) * 30 * DAY_MS)), name: `${name} ${i + 1}` }));
}

async function memberContext(tenantId: string, userId: string): Promise<RequestContext> {
    const ctx = await resolveMemberContext({ tenantId, userId, job: 'seed-scale' });
    if (!ctx) throw new Error(`seed-scale: member ${userId} did not resolve in ${tenantId}`);
    return ctx;
}

const contexts = new Map<string, RequestContext>();
/** A member's request context, resolved once through the jobs' real resolution. */
export async function contextOf(ws: SeedWorkspace, member: SeedMember): Promise<RequestContext> {
    const key = `${ws.tenantId}:${member.userId}`;
    const hit = contexts.get(key);
    if (hit) return hit;
    const ctx = await memberContext(ws.tenantId, member.userId);
    contexts.set(key, ctx);
    return ctx;
}

/** Is the workspace already there, and complete? Throws on a partial one. */
export async function existingWorkspace(slug: string, expectedItems: number): Promise<string | null> {
    const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (!tenant) return null;
    const items = await prisma.workItem.count({ where: { tenantId: tenant.id } });
    if (items !== expectedItems) {
        throw new Error(`seed-scale: workspace ${slug} exists with ${items} of ${expectedItems} items; seed into an empty database`);
    }
    return tenant.id;
}

/** The bootstrap and the configuration of one workspace. Items come after (bulk.ts, sample.ts). */
export async function seedConfiguration(env: SeedEnv, bulk: PrismaClient, shape: Shape, slug: string): Promise<SeedWorkspace> {
    const rng: Rng = stream(env.seed, `${slug}:configuration`);
    const domain = `${slug}.seed.invalid`;
    const passwordHash = await hashPassword(SEED_PASSWORD);

    // ── The bootstrap registration performs ─────────────────────────────
    const ownerEmail = lookupEmail(`owner@${domain}`);
    const created = await prisma.$transaction(async (tx) => {
        const { wrapped } = generateAndWrapDek();
        const tenant = await tx.tenant.create({ data: { name: `Perf ${slug}`, slug, encryptedDek: wrapped }, select: { id: true } });
        const user = await tx.user.create({ data: { email: ownerEmail, name: 'Seed Owner', passwordHash }, select: { id: true } });
        await tx.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id, role: 'OWNER' } });
        return { tenantId: tenant.id, ownerId: user.id };
    });
    const owner = await memberContext(created.tenantId, created.ownerId);
    env.log(`  ${slug}: workspace and owner`);

    // ── Members: accounts, then invitations and their redemption ─────────
    const invited: SeedMember[] = [];
    for (let k = 1; k < shape.members; k++) {
        const email = lookupEmail(`member${String(k).padStart(3, '0')}@${domain}`);
        const role = roleFor(k, shape.members);
        // The heavy member (k = 3, the first plain MEMBER) signs in for H2b's harness.
        const user = await prisma.user.create({
            data: { email, name: `Seed Member ${k}`, passwordHash: k === 3 ? passwordHash : null },
            select: { id: true },
        });
        const { invite } = await createInviteToken(owner, { email, role });
        await redeemInvite({ token: invite.token, userId: user.id, userEmail: email });
        invited.push({ userId: user.id, email, role, writer: role !== 'VIEWER' });
    }
    // The heavy member: the first plain MEMBER invited (k = 3), Zipf rank 0.
    const heavyIndex = invited.findIndex((m) => m.role === 'MEMBER');
    const heavy = invited.splice(heavyIndex, 1)[0]!;
    const ownerMember: SeedMember = { userId: created.ownerId, email: ownerEmail, role: 'OWNER', writer: true };
    const members = [heavy, ...invited, ownerMember];
    env.log(`  ${slug}: ${members.length} members (${members.filter((m) => !m.writer).length} viewers)`);
    if (hashForLookup(heavy.email) === hashForLookup(ownerEmail)) throw new Error('seed-scale: heavy member is the owner');

    // ── Teams and their workflows ─────────────────────────────────────────
    const teams: SeedTeam[] = [];
    for (let t = 0; t < shape.teams; t++) {
        const team = await createTeam(owner, { name: `Team ${t + 1}` });
        const states: Record<string, SeedState> = {};
        for (const s of team.workflowStates) states[s.name] = { id: s.id, category: s.category };
        teams.push({ id: team.id, states, cycles: cycleWindows(env.anchor) });
    }
    const typeIds = (await listWorkItemTypes(owner)).map((t) => t.id);

    // ── Working calendars (3.1a): the workspace's and the first team's, with holidays ──
    await setWorkspaceWorkingCalendar(owner, { timeZone: 'Europe/Sofia', workingWeekdays: [1, 2, 3, 4, 5] });
    await addWorkspaceHolidays(owner, { holidays: holidaysAround(env.anchor, 'Public holiday') });
    await setTeamWorkingCalendar(owner, teams[0]!.id, { timeZone: 'Europe/Sofia', workingWeekdays: [1, 2, 3, 4, 5] });
    await addTeamHolidays(owner, teams[0]!.id, { holidays: holidaysAround(new Date(env.anchor.getTime() + 3 * DAY_MS), 'Team day off') });

    // ── Labels ─────────────────────────────────────────────────────────────
    const labelIds: string[] = [];
    const labelWords = rng.sample([...ENGLISH_WORDS, ...BULGARIAN_WORDS], RATIOS.labels * 3);
    const seenLabel = new Set<string>();
    for (const word of labelWords) {
        if (labelIds.length >= RATIOS.labels || seenLabel.has(word)) continue;
        seenLabel.add(word);
        labelIds.push((await createLabel(owner, { name: word })).id);
    }

    // ── Projects, their fields and milestones ──────────────────────────────
    const projects: SeedProject[] = [];
    for (const [p, size] of shape.projects.entries()) {
        const teamId = teams[p % teams.length]!.id;
        const keyPrefix = prefixFor(p);
        const project = await createProject(owner, { teamId, name: `Project ${keyPrefix}`, keyPrefix });
        const fields: SeedField[] = [];
        for (const def of FIELD_DEFS) {
            const field = await createCustomField(owner, project.id, {
                name: def.name,
                type: def.type,
                ...('options' in def ? { options: def.options.map((name) => ({ name })) } : {}),
            });
            fields.push({ id: field.id, type: def.type, options: (field.options ?? []).map((o) => o.id) });
        }
        const milestones: string[] = [];
        for (let m = 0; m < RATIOS.milestonesPerProject; m++) {
            const due = new Date(env.anchor.getTime() + (m * 60 - 30) * DAY_MS);
            milestones.push((await createMilestone(owner, project.id, { name: `Milestone ${m + 1}`, dueDate: dayKey(due) })).id);
        }
        projects.push({ id: project.id, keyPrefix, teamId, size, fields, milestones });
    }
    env.log(`  ${slug}: ${teams.length} team(s), ${projects.length} projects, ${labelIds.length} labels`);

    const ws: SeedWorkspace = {
        tenantId: created.tenantId,
        slug,
        owner,
        members,
        writers: members.filter((m) => m.writer),
        teams,
        typeIds,
        labelIds,
        projects,
    };

    // ── Cycles: the past ones in bulk (completed), then the rest through the usecase ──
    await insertPastCycles(bulk, ws);
    for (const team of teams) {
        for (const [i, w] of team.cycles.entries()) {
            if (w.past) continue;
            const cycle = await createCycle(owner, { teamId: team.id, name: `Cycle ${i + 1}`, startsOn: w.startsOn, endsOn: w.endsOn });
            w.id = cycle.id;
        }
    }
    return ws;
}

/**
 * The cycles that ended before the anchor, completed the day after they
 * ended, as the rollover leaves them. Written before any usecase cycle so
 * their numbers come first.
 */
async function insertPastCycles(bulk: PrismaClient, ws: SeedWorkspace): Promise<void> {
    for (const team of ws.teams) {
        const past = team.cycles.filter((c) => c.past);
        const rng = stream(ws.slug, `cycles:${team.id}`);
        for (const c of past) c.id = rng.id();
        await bulk.cycle.createMany({
            data: past.map((c, i) => {
                const completedAt = new Date(new Date(`${c.endsOn}T00:00:00Z`).getTime() + DAY_MS + 15 * 60_000);
                return {
                    id: c.id!,
                    tenantId: ws.tenantId,
                    teamId: team.id,
                    number: i + 1,
                    name: `Cycle ${i + 1}`,
                    startsOn: new Date(`${c.startsOn}T00:00:00Z`),
                    endsOn: new Date(`${c.endsOn}T00:00:00Z`),
                    fromSchedule: false,
                    completedAt,
                    createdAt: new Date(new Date(`${c.startsOn}T00:00:00Z`).getTime() - 7 * DAY_MS),
                };
            }),
        });
    }
}
