/**
 * A public intake form (sub-phase 2.6b; owner decisions 86, 88 and 98),
 * reached at `/f/<publicId>` with no session. Server-rendered from the form's
 * own published text and a freshly signed form token; every case of a form
 * that is not open to the public (unknown, members only, unpublished or
 * archived, its project archived, deleted or with intake off, its workspace
 * deleted, public forms closed on this deployment) is the one 404.
 *
 * It never reads the session: a signed-in member who opens the link is anyone
 * else.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PublicIntakeForm } from '@/components/intake/public/PublicIntakeForm';
import { getPublicIntakeForm } from '@/app-layer/usecases/intake-public';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PublicIntakeFormPage({ params }: { params: Promise<{ publicId: string }> }) {
    const { publicId } = await params;
    const view = await getPublicIntakeForm(publicId);
    if (!view) notFound();
    return <PublicIntakeForm publicId={view.publicId} name={view.name} definition={view.definition} token={view.token} />;
}
