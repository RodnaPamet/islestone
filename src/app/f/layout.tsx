/**
 * The layout of the public intake pages (sub-phase 2.6b): outside the app
 * shell, a single centred column on the theme's tokens. Nothing here names a
 * workspace, a project or a member. Written fresh for Islestone.
 */
import type { ReactNode } from 'react';

export default function PublicIntakeLayout({ children }: { children: ReactNode }) {
    return (
        <main className="min-h-screen bg-bg-default px-4 py-page">
            <div className="mx-auto w-full max-w-xl rounded-lg border border-border-default bg-bg-subtle p-6">{children}</div>
        </main>
    );
}
