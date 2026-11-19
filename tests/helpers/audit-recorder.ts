/**
 * Records the entries the sub-phase 1.4 audit stubs receive, for integration
 * suites copied from inflect-compliance that read `AuditLog` / `OrgAuditLog`.
 *
 * Islestone has no audit tables until sub-phase 1.5: `@/lib/audit` and
 * `@/lib/audit/org-audit-writer` write one structured log line per entry.
 * A suite that asserted on audit ROWS asserts on the entries the writer was
 * handed instead, which is the same claim one step earlier: the usecase
 * called the audit writer, with this action, for this entity. When 1.5 lands
 * the tables, those suites go back to reading rows.
 *
 * Use it from a test file with BOTH mocks, before the imports they affect:
 *
 *     jest.mock('@/lib/audit', () => jest.requireActual('../helpers/audit-recorder').auditModuleMock());
 *     jest.mock('@/lib/audit/org-audit-writer', () =>
 *         jest.requireActual('../helpers/audit-recorder').orgAuditModuleMock());
 *
 * Each mock wraps the real stub, so the log line is still written.
 */
import type * as AuditModule from '@/lib/audit';
import type { AppendAuditInput } from '@/lib/audit';
import type * as OrgAuditModule from '@/lib/audit/org-audit-writer';
import type { AppendOrgAuditInput } from '@/lib/audit/org-audit-writer';

const entries: AppendAuditInput[] = [];
const orgEntries: AppendOrgAuditInput[] = [];

export function auditModuleMock(): typeof AuditModule {
    const actual = jest.requireActual('@/lib/audit') as typeof AuditModule;
    const appendAuditEntry: typeof actual.appendAuditEntry = async (input, client) => {
        entries.push(input);
        return actual.appendAuditEntry(input, client);
    };
    return {
        ...actual,
        appendAuditEntry,
        appendAuditEntryOrQueue: async (input, client) => {
            const result = await appendAuditEntry(input, client);
            return { recorded: 'chain', auditId: result.id };
        },
    };
}

export function orgAuditModuleMock(): typeof OrgAuditModule {
    const actual = jest.requireActual('@/lib/audit/org-audit-writer') as typeof OrgAuditModule;
    return {
        ...actual,
        appendOrgAuditEntry: async (input, client) => {
            orgEntries.push(input);
            return actual.appendOrgAuditEntry(input, client);
        },
    };
}

type AuditFilter = Partial<Pick<AppendAuditInput, 'tenantId' | 'userId' | 'entityId' | 'action' | 'entity'>>;

/** Recorded tenant audit entries matching every given field, oldest first. */
export function auditEntries(filter: AuditFilter = {}): AppendAuditInput[] {
    return entries.filter((e) =>
        (Object.keys(filter) as Array<keyof AuditFilter>).every((k) => e[k] === filter[k]),
    );
}

type OrgAuditFilter = Partial<Pick<AppendOrgAuditInput, 'organizationId' | 'action' | 'actorUserId'>>;

/** Recorded organization audit entries matching every given field, oldest first. */
export function orgAuditEntries(filter: OrgAuditFilter = {}): AppendOrgAuditInput[] {
    return orgEntries.filter((e) =>
        (Object.keys(filter) as Array<keyof OrgAuditFilter>).every((k) => e[k] === filter[k]),
    );
}

/** Forget everything recorded so far. */
export function clearAuditEntries(): void {
    entries.length = 0;
    orgEntries.length = 0;
}
