/**
 * Absolute links for email bodies (inflect-compliance #4130).
 *
 * An email is opened in a mail client, not in the app, so a relative href such
 * as `/t/acme/work-items` resolves against nothing and the button does not
 * open the page. Every template that links into the app goes through this
 * helper, so there is one place that knows how
 * (`tests/unit/notification-email-links-absolute.test.ts` holds it).
 *
 * `NEXT_PUBLIC_APP_URL` is the source: the deployment's public origin, which
 * `src/env-client.ts` requires. A server module may import the client env
 * module (not the reverse), and one variable for one origin is enough. With it
 * empty the path is returned unchanged, because a deployment without one has
 * no public origin to name, and inventing `localhost` would send a customer a
 * link to their own machine.
 *
 * Copied from inflect-compliance `src/app-layer/notifications/app-link.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (reads `NEXT_PUBLIC_APP_URL`, not
 * the server `APP_URL`).
 */
import { env } from '@/env-client';

/** `path` (starting with `/`) made absolute against `NEXT_PUBLIC_APP_URL`, when it is set. */
export function appLink(path: string): string {
    const origin = (env.NEXT_PUBLIC_APP_URL ?? '').trim().replace(/\/+$/, '');
    return `${origin}${path}`;
}
