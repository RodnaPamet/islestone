/**
 * The assignment mail's digest form and the type name (sub-phase 2.2): one
 * mail for everything a bulk assign newly handed over, the type row's name
 * rendered as given ("assigned you a Bug"), titles escaped, and no parent
 * product sign-off or "View Tasks" button.
 *
 * Copied in shape from inflect-compliance's
 * `tests/unit/notification-task-assigned-digest.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, against the react-email template.
 */
import { buildWorkItemAssignedEmail } from '@/app-layer/notifications/templates';

const ORIGIN = 'https://app.example.test';
let saved: string | undefined;
beforeAll(() => {
    saved = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = ORIGIN;
});
afterAll(() => {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = saved;
});

describe('the work-item assignment mail', () => {
    it('names the type as given in the single mail', async () => {
        const mail = await buildWorkItemAssignedEmail({
            workItemTitle: 'Login fails',
            workItemKey: 'ISL-4',
            workItemTypeName: 'Bug',
            assigneeName: 'Max',
            assignerName: 'Olive',
            linkPath: '/t/acme/work-items/w4',
        });
        expect(mail.bodyText).toContain('Olive assigned you a Bug:');
        expect(mail.bodyHtml).toContain('assigned you a Bug');
    });

    it('one digest for several items, each line with its key and type, linking to My Work', async () => {
        const mail = await buildWorkItemAssignedEmail({
            items: [
                { workItemTitle: 'First <b>bold</b>', workItemKey: 'ISL-1', workItemTypeName: 'Feature' },
                { workItemTitle: 'Second', workItemKey: 'ISL-2', workItemTypeName: 'Chore' },
            ],
            assigneeName: 'Max',
            linkPath: '/t/acme/my-work',
        });
        expect(mail.subject).toBe('2 work items assigned to you');
        expect(mail.bodyText).toContain('[ISL-1] First <b>bold</b> (Feature)');
        expect(mail.bodyText).toContain('[ISL-2] Second (Chore)');
        expect(mail.bodyText).toContain(`${ORIGIN}/t/acme/my-work`);
        expect(mail.bodyHtml).not.toContain('<b>bold</b>');
        expect(mail.bodyHtml).toContain('&lt;b&gt;bold&lt;/b&gt;');
    });

    it('carries no parent product sign-off and no task wording', async () => {
        const mail = await buildWorkItemAssignedEmail({ items: [{ workItemTitle: 'x' }], assigneeName: 'Max', linkPath: '/t/acme/my-work' });
        for (const text of [mail.bodyText, mail.bodyHtml, mail.subject]) {
            expect(text).not.toMatch(/Inflect|View Tasks|\btask/i);
        }
    });
});
