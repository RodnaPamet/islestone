import { EmptyState } from '@inflect/ui/components/ui/empty-state';

import { PageHeader } from './PageHeader';

/**
 * A shell destination whose feature arrives in a later sub-phase: the page
 * header (its title is the sidebar's label) and one empty state saying the
 * feature is not here yet. Written fresh for Islestone (sub-phase 1.7), so
 * the navigation has no link that 404s. Each page that renders it is
 * replaced by its feature: My Work and Inbox (2.7), Views (2.4), Projects
 * (2.1, 2.3), Settings (1.4's admin pages, 8.3).
 *
 * A server component; the page resolves both strings from the catalogue
 * (`nav.*`, `placeholders.*`).
 */
export function PlaceholderPage({
    title,
    emptyTitle,
    body,
    testId,
}: {
    title: string;
    emptyTitle: string;
    body: string;
    /** `data-testid` on the page's wrapper, `placeholder-<page>`. */
    testId: string;
}) {
    return (
        <div className="space-y-section" data-testid={testId}>
            <PageHeader title={title} />
            <EmptyState title={emptyTitle} description={body} />
        </div>
    );
}
