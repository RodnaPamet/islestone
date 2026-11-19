import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { buttonVariants } from '@inflect/ui/components/ui/button-variants';
import { Heading } from '@inflect/ui/components/ui/typography';

/**
 * The root not-found boundary (404).
 *
 * Copied from inflect-compliance `src/app/not-found.tsx` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 1.7). Its link goes to
 * the workspace picker, `/tenants`, so its label says so.
 */
export default async function NotFound() {
    const t = await getTranslations('errorPage');
    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-bg-page p-6">
            <div className="max-w-md w-full text-center space-y-section">
                <div className="text-content-emphasis font-semibold text-6xl tracking-tighter tabular-nums">404</div>

                <div>
                    <Heading level={1} className="mb-3">
                        {t('notFoundTitle')}
                    </Heading>
                    <p className="text-sm text-content-muted">{t('notFoundBody')}</p>
                </div>

                <div className="pt-6">
                    <Link href="/tenants" className={buttonVariants({ variant: 'primary' })}>
                        {t('returnToWorkspaces')}
                    </Link>
                </div>
            </div>
        </div>
    );
}
