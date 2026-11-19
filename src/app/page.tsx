import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth/session';

/**
 * The root page: sends a signed-in person to the workspace picker,
 * `/tenants`, which handles none, one and several workspaces (one goes
 * straight to that workspace's My Work), and anybody else to `/login`.
 *
 * Copied from inflect-compliance `src/app/page.tsx` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 1.7); it replaces the
 * 1.1 placeholder home. The session is read through Islestone's seam.
 */
export default async function Home() {
    const session = await getSession();
    if (!session) redirect('/login');
    redirect('/tenants');
}
