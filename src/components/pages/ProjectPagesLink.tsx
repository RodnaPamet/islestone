'use client';

/**
 * The project page's link to its page tree (sub-phase 4.1a, decision 341),
 * in the page header's actions, as the milestones link is.
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { useTenantHref } from '@/lib/tenant-context-provider';

export function ProjectPagesLink({ keyPrefix }: { keyPrefix: string }) {
    const tLink = useTranslations('pages');
    const tenantHref = useTenantHref();
    return (
        <Link
            href={tenantHref(`/projects/${encodeURIComponent(keyPrefix)}/pages`)}
            className="rounded-md border border-border-default px-3 py-1.5 text-sm text-content-default hover:bg-bg-muted"
        >
            {tLink('open')}
        </Link>
    );
}
