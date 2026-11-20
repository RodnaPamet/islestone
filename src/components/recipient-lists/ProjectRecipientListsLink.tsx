'use client';

/**
 * The project page's link to its recipient lists (sub-phase 2.7e), in the
 * page header's actions.
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { useTenantHref } from '@/lib/tenant-context-provider';

export function projectRecipientListsHref(keyPrefix: string): string {
    return `/projects/${encodeURIComponent(keyPrefix)}/recipient-lists`;
}

export function ProjectRecipientListsLink({ keyPrefix }: { keyPrefix: string }) {
    const tLink = useTranslations('recipientLists');
    const tenantHref = useTenantHref();
    return (
        <Link
            href={tenantHref(projectRecipientListsHref(keyPrefix))}
            className="rounded-md border border-border-default px-3 py-1.5 text-sm text-content-default hover:bg-bg-muted"
        >
            {tLink('open')}
        </Link>
    );
}
