'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Card } from '@inflect/ui/components/ui/card';
import { ErrorState } from '@inflect/ui/components/ui/error-state';

/**
 * Error boundary for the workspace app shell.
 *
 * Catches errors in any page within (app)/ — work items, projects, views —
 * and renders a recovery UI *inside* the shell. Without it, errors bubble to
 * the root error.tsx, which unmounts the whole shell and leaves the member on
 * a page with no navigation.
 *
 * Copied from inflect-compliance `src/app/t/[tenantSlug]/(app)/error.tsx` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 1.7). Cut: the
 * `console.error` effect (`no-console`; server errors are reported on the
 * server). The secondary action goes to My Work, read from the route's slug.
 */
export default function AppSectionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    const t = useTranslations('common');
    const params = useParams<{ tenantSlug?: string }>();
    const myWork = params?.tenantSlug ? `/t/${encodeURIComponent(params.tenantSlug)}/my-work` : '/tenants';

    return (
        <div className="space-y-section animate-fadeIn">
            <Card className="max-w-xl mx-auto mt-12">
                <ErrorState
                    title={t('error.title')}
                    description={
                        <>
                            {t('error.body')}
                            {error.digest && (
                                <span className="block mt-2 text-xs font-mono text-content-subtle">
                                    {t('error.errorId', { id: error.digest })}
                                </span>
                            )}
                        </>
                    }
                    onRetry={() => reset()}
                    secondaryAction={{
                        label: t('error.goToMyWork'),
                        onClick: () => {
                            window.location.href = myWork;
                        },
                    }}
                    data-testid="app-section-error"
                />
            </Card>
        </div>
    );
}
