import type { Metadata } from 'next';

import { Gallery } from './gallery';

export const metadata: Metadata = {
    title: 'UI gallery · Islestone',
    description: 'The shared UI primitives in the light and the dark theme.',
};

/**
 * The shared-UI gallery (roadmap 1.2, "done when"): the main primitives from
 * packages/ui and src/components/ui, rendered side by side in both themes.
 * Islestone-owned, outside the mirrored roots.
 */
export default function GalleryPage() {
    return (
        <main className="mx-auto max-w-screen-2xl space-y-section px-4 py-page">
            <h1 className="text-2xl font-semibold tracking-tight">UI gallery</h1>
            <p className="text-sm text-content-muted">The shared UI primitives, in the light and the dark theme.</p>
            <Gallery />
        </main>
    );
}
