'use client';

/**
 * The list's note that `q` matched more descriptions and comments than the
 * content search ranks (owner decision 250, issue #89; docs/search.md, "The
 * bound on content matches"): the matches it shows from descriptions and
 * comments are the most recently written ones. Shown by the list layout of
 * the Work items, project, cycle and milestone pages and by each My Work
 * section whose read reported `contentMatchesBounded`.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';

export function RecentMatchesNote() {
    const tNote = useTranslations('workItems');
    return (
        <p role="note" className="text-xs text-content-muted">
            {tNote('list.recentMatches')}
        </p>
    );
}
