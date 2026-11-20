/**
 * The email templates: what each says, that every link in it opens from a mail
 * client, and that a title cannot inject markup.
 *
 *   - `buildWorkItemAssignedEmail`: subject and copy, with and without the item
 *     key and the assigner.
 *   - `buildWorkItemWaitingOnEmail` (2.7c): who set it, the item, the link.
 *   - `buildNotificationDigestEmail` (2.7c): the subject counts both sections,
 *     due groups in order (overdue, today, soon), the bell copy listed, the
 *     "and N more" lines, the Inbox and preferences links.
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
import {
    buildNotificationDigestEmail,
    buildWorkItemAssignedEmail,
    buildWorkItemWaitingOnEmail,
    type EmailTemplateResult,
    type NotificationDigestPayload,
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

const digest = (over: Partial<NotificationDigestPayload> = {}): NotificationDigestPayload => ({
    recipientName: 'Dana',
    tenantSlug: 'acme',
    due: [
        { key: 'ISL-3', title: 'Soon one', dueDate: '2026-10-05', group: 'SOON', waitingOnYou: false, linkPath: '/t/acme/work-items/w3' },
        { key: 'ISL-1', title: 'Overdue one', dueDate: '2026-09-28', group: 'OVERDUE', waitingOnYou: true, linkPath: '/t/acme/work-items/w1' },
        { key: 'ISL-2', title: 'Today one', dueDate: '2026-10-01', group: 'TODAY', waitingOnYou: false, linkPath: '/t/acme/work-items/w2' },
    ],
    moreDue: 0,
    notifications: [{ title: 'Watched work item updated', body: 'ISL-9 "Ship it": commented', linkPath: '/t/acme/work-items/w9' }],
    moreNotifications: 0,
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

describe('buildWorkItemWaitingOnEmail', () => {
    const waiting = { recipientName: 'Ana', setterName: 'Bob Lee', workItemTitle: 'Approve the plan', workItemKey: 'ISL-7', linkPath: '/t/acme/work-items/w7' };

    it('names the item in the subject and who set it in the body', async () => {
        const email = await buildWorkItemWaitingOnEmail(waiting);
        expect(email.subject).toBe('Waiting on you: [ISL-7] Approve the plan');
        expect(email.bodyText).toContain('Bob Lee marked a work item as waiting on you:');
        expect(email.bodyHtml).toContain('A work item is waiting on you');
    });

    it('reads without a setter', async () => {
        const email = await buildWorkItemWaitingOnEmail({ ...waiting, setterName: undefined });
        expect(email.bodyText).toContain('A work item is now waiting on you:');
    });

    it('every link is absolute and points at the item', async () => {
        expectAllAbsolute(await buildWorkItemWaitingOnEmail(waiting), `${ORIGIN}/t/acme/work-items/w7`);
    });
});

describe('buildNotificationDigestEmail', () => {
    it('counts both sections in the subject', async () => {
        expect((await buildNotificationDigestEmail(digest())).subject).toBe('Your daily digest: 3 work items due, 1 notification');
        expect((await buildNotificationDigestEmail(digest({ due: [] }))).subject).toBe('Your daily digest: 1 notification');
        expect((await buildNotificationDigestEmail(digest({ notifications: [], moreDue: 2 }))).subject).toBe('Your daily digest: 5 work items due');
    });

    it('groups due items overdue, then today, then soon, and marks the ones waiting on the reader', async () => {
        const email = await buildNotificationDigestEmail(digest());
        const at = (s: string) => email.bodyText.indexOf(s);
        expect(at('Overdue one')).toBeGreaterThan(-1);
        expect(at('Overdue one')).toBeLessThan(at('Today one'));
        expect(at('Today one')).toBeLessThan(at('Soon one'));
        expect(email.bodyText).toContain('[ISL-1] Overdue one — due 2026-09-28 (waiting on you)');
        expect(email.bodyText).not.toContain('Today one — due 2026-10-01 (waiting on you)');
    });

    it('lists the bell copy and counts what is past the cap', async () => {
        const email = await buildNotificationDigestEmail(digest({ moreDue: 4, moreNotifications: 7 }));
        expect(email.bodyText).toContain('Watched work item updated — ISL-9 "Ship it": commented');
        expect(email.bodyText).toContain('And 4 more.');
        expect(email.bodyText).toContain('And 7 more in your Inbox.');
    });

    it('every link is absolute: the items, the notifications, the Inbox and the preferences', async () => {
        const email = await buildNotificationDigestEmail(digest());
        expectAllAbsolute(email, `${ORIGIN}/t/acme/`);
        expect(email.bodyText).toContain(`${ORIGIN}/t/acme/inbox`);
        expect(email.bodyText).toContain(`${ORIGIN}/t/acme/inbox/preferences`);
    });

    it('escapes a title that carries markup', async () => {
        const email = await buildNotificationDigestEmail(
            digest({ due: [{ key: 'ISL-1', title: '<script>alert(1)</script>', dueDate: '2026-10-01', group: 'TODAY', waitingOnYou: false, linkPath: '/t/acme/work-items/w1' }] }),
        );
        expect(email.bodyHtml).not.toContain('<script>alert(1)');
    });
});
