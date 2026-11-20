'use client';

/**
 * The project page's link to its milestones (sub-phase 2.5b), in the page
 * header's actions.
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { useTenantHref } from '@/lib/tenant-context-provider';

export function ProjectMilestonesLink({ keyPrefix }: { keyPrefix: string }) {
    const tLink = useTranslations('milestones');
    const tenantHref = useTenantHref();
    return (
        <Link
            href={tenantHref(`/projects/${encodeURIComponent(keyPrefix)}/milestones`)}
            className="rounded-md border border-border-default px-3 py-1.5 text-sm text-content-default hover:bg-bg-muted"
        >
            {tLink('open')}
        </Link>
    );
}
