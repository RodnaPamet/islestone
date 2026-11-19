import { redirect } from 'next/navigation';

import { NAV_PATHS } from '@/components/layout/nav-config';

/**
 * The workspace root, `/t/<slug>`, goes to My Work, the workspace's landing
 * page (ADR 0006). The layout around it has already admitted the member.
 */
export default async function WorkspaceRootPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    redirect(`/t/${encodeURIComponent(tenantSlug)}${NAV_PATHS.myWork}`);
}
