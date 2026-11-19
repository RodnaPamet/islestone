'use client'; // Error boundaries must be Client Components

import { useTranslations } from 'next-intl';

import { Card } from '@inflect/ui/components/ui/card';
import { ErrorState } from '@inflect/ui/components/ui/error-state';

/**
 * Root error boundary for the App Router: catches unhandled errors in server
 * and client components below the root layout, so the app does not crash
 * entirely.
 *
 * Copied from inflect-compliance `src/app/error.tsx` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 1.7). Cut: the browser
 * Sentry call and its `console.error` fallback. Islestone reports errors on
 * the server only (sub-phase 1.6, `src/lib/observability/sentry.ts`), and
 * `no-console` holds in `src/`. The secondary action goes to the workspace
 * picker, `/tenants`.
 */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    const t = useTranslations('errorPage');

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-bg-page p-6">
            <Card elevation="floating" className="max-w-md w-full">
                <ErrorState
                    title={t('title')}
                    description={
                        <>
                            {t('description')}
                            {error.digest && (
                                <span className="block mt-2 text-xs font-mono text-content-subtle">
                                    {t('errorId', { id: error.digest })}
                                </span>
                            )}
                        </>
                    }
                    onRetry={() => reset()}
                    secondaryAction={{
                        label: t('goToWorkspaces'),
                        onClick: () => {
                            // A full load, not a client navigation: the
                            // router may be part of what failed.
                            window.location.assign(new URL('/tenants', window.location.origin));
                        },
                    }}
                    data-testid="global-error"
                />
            </Card>
        </div>
    );
}
