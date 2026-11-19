/**
 * The email templates: what each says, that every link in it opens from a mail
 * client, and that a title cannot inject markup.
 *
 *   - `buildWorkItemAssignedEmail`: subject and copy, with and without the item
 *     key and the assigner.
 *   - `buildDueDigestEmail`: the two audiences' copy (an assignee's digest
 *     claims the items are theirs; an admin's says they are unassigned and why
 *     the admin is reading it), singular and plural, urgency groups in order.
 *   - Links (inflect #4130): a relative href resolves against nothing in a mail
 *     client, so every href in the HTML and every app path in the text is
 *     asserted absolute against `NEXT_PUBLIC_APP_URL` — one relative link left
 *     in a body is the bug.
 *   - A work-item title is user text: the HTML body escapes it.
 *
 * Copied from inflect-compliance `tests/unit/notification-templates.test.ts`
 * and `tests/unit/notification-email-links-absolute.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e and rewritten over Islestone's two
 * react-email templates (the compliance templates are not ported); the
 * escaping case is new.
 */
import type { DueItem } from '@/app-layer/jobs/types';
import {
    buildDueDigestEmail,
    buildWorkItemAssignedEmail,
    type EmailTemplateResult,
} from '@/app-layer/notifications/templates';

const ORIGIN = 'https://app.example.test';

let savedAppUrl: string | undefined;
beforeAll(() => {
    savedAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    // Trailing slash on purpose: appLink must not double it.
    process.env.NEXT_PUBLIC_APP_URL = `${ORIGIN}/`;
});
afterAll(() => {
    if (savedAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = savedAppUrl;
});

/** Every href in the HTML body and every in-app path in the text body. */
function linksOf(email: EmailTemplateResult): { hrefs: string[]; textPaths: string[] } {
    const hrefs = [...email.bodyHtml.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!);
    const textPaths = [...email.bodyText.matchAll(/(\S*)\/t\/[\w-]+\S*/g)].map((m) => m[0]);
    return { hrefs, textPaths };
}

function expectAllAbsolute(email: EmailTemplateResult, prefix: string) {
    const { hrefs, textPaths } = linksOf(email);
    // The population is real: every one of these bodies links somewhere.
    expect(hrefs.length).toBeGreaterThan(0);
    expect(textPaths.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href.startsWith(prefix)).toBe(true);
    for (const p of textPaths) expect(p.startsWith(prefix)).toBe(true);
}

const assigned = {
    workItemTitle: 'Patch the edge firewall',
    workItemKey: 'ISL-42',
    assigneeName: 'Alice Smith',
    assignerName: 'Bob Lee',
    linkPath: '/t/acme/work-items/wi-1',
};

const item = (over: Partial<DueItem> = {}): DueItem => ({
    entityType: 'WORK_ITEM',
    entityId: 'wi-1',
    tenantId: 'tenant-1',
    name: 'Rotate the certificates',
    reason: 'Due in 2 day(s)',
    urgency: 'URGENT',
    dueDate: '2026-10-01T00:00:00.000Z',
    daysRemaining: 2,
    ...over,
});

describe('buildWorkItemAssignedEmail', () => {
    it('names the key and title in the subject, the assignee and the assigner in the body', async () => {
        const email = await buildWorkItemAssignedEmail(assigned);
        expect(email.subject).toBe('Assigned to you: [ISL-42] Patch the edge firewall');
        expect(email.bodyText).toContain('Hi Alice Smith,');
        expect(email.bodyText).toContain('Bob Lee assigned you a work item:');
        expect(email.bodyHtml).toContain('A work item was assigned to you');
        expect(email.bodyHtml).toContain('Patch the edge firewall');
    });

    it('reads without a key or an assigner', async () => {
        const email = await buildWorkItemAssignedEmail({ ...assigned, workItemKey: null, assignerName: undefined });
        expect(email.subject).toBe('Assigned to you: Patch the edge firewall');
        expect(email.bodyText).toContain('You were assigned a work item:');
        expect(email.bodyText).not.toContain('Bob Lee');
    });

    it('every link is absolute and points at the item', async () => {
        const email = await buildWorkItemAssignedEmail(assigned);
        expectAllAbsolute(email, `${ORIGIN}/t/acme/work-items/wi-1`);
    });

    it('escapes a title that carries markup', async () => {
        const email = await buildWorkItemAssignedEmail({ ...assigned, workItemTitle: '<img src=x onerror=alert(1)>' });
        expect(email.bodyHtml).not.toContain('<img src=x');
        expect(email.bodyHtml).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });
});

describe('buildDueDigestEmail', () => {
    it("an assignee's digest says the items are theirs", async () => {
        const email = await buildDueDigestEmail({
            recipientName: 'Dana',
            tenantSlug: 'acme',
            items: [item(), item({ entityId: 'wi-2', name: 'Renew the domain' })],
            audience: 'OWNER',
        });
        expect(email.subject).toBe('2 work items due');
        expect(email.bodyText).toContain('You have 2 work items that need your attention:');
        expect(email.bodyText).not.toContain('no assignee');
    });

    it("an admin's digest says the items are unassigned and why the admin reads it", async () => {
        const email = await buildDueDigestEmail({
            recipientName: 'Owner',
            tenantSlug: 'acme',
            items: [item()],
            audience: 'TENANT_ADMIN',
        });
        expect(email.subject).toBe('1 unassigned work item needs an assignee');
        expect(email.bodyText).toContain('1 work item in this workspace has no assignee.');
        expect(email.bodyText).toContain('not because these items are assigned to you');
        expect(email.bodyText).not.toContain('You have');
    });

    it('marks an overdue digest in the subject, and groups overdue before urgent before upcoming', async () => {
        const email = await buildDueDigestEmail({
            recipientName: 'Dana',
            tenantSlug: 'acme',
            items: [
                item({ entityId: 'u', name: 'Upcoming one', urgency: 'UPCOMING' }),
                item({ entityId: 'o', name: 'Overdue one', urgency: 'OVERDUE', daysRemaining: -1 }),
                item({ entityId: 'r', name: 'Urgent one', urgency: 'URGENT' }),
            ],
            audience: 'OWNER',
        });
        expect(email.subject.startsWith('Overdue: ')).toBe(true);
        const at = (s: string) => email.bodyText.indexOf(s);
        expect(at('Overdue one')).toBeGreaterThan(-1);
        expect(at('Overdue one')).toBeLessThan(at('Urgent one'));
        expect(at('Urgent one')).toBeLessThan(at('Upcoming one'));
        expect(email.bodyText).toContain('1 overdue, 1 due soon, 1 upcoming');
    });

    it('every link is absolute and points at the workspace', async () => {
        const email = await buildDueDigestEmail({ recipientName: 'Dana', tenantSlug: 'acme', items: [item()], audience: 'OWNER' });
        expectAllAbsolute(email, `${ORIGIN}/t/acme`);
    });

    it('escapes an item name that carries markup', async () => {
        const email = await buildDueDigestEmail({
            recipientName: 'Dana',
            tenantSlug: 'acme',
            items: [item({ name: '<script>alert(1)</script>' })],
            audience: 'OWNER',
        });
        expect(email.bodyHtml).not.toContain('<script>alert(1)');
    });
});
