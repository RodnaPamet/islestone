/**
 * A public form's requester confirms their address (sub-phase 2.6b; owner
 * decision 89): the page the confirmation email links to. Opening it changes
 * nothing (mail scanners follow links); its button POSTs the token. It reads
 * nothing, so it says nothing about whether the token is valid until the
 * button is pressed. Closed with public forms.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ConfirmAddress } from '@/components/intake/public/ConfirmAddress';
import { isPublicIntakeOpen } from '@/lib/intake/public-switch';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ConfirmAddressPage({ params }: { params: Promise<{ token: string }> }) {
    if (!isPublicIntakeOpen()) notFound();
    const { token } = await params;
    return <ConfirmAddress token={token} />;
}
