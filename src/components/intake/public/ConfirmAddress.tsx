'use client';

/**
 * The requester's confirmation page body (sub-phase 2.6b; owner decision
 * 89): a button that POSTs the emailed token. Opening the page confirms
 * nothing, because mail scanners follow links; a person pressing the button
 * does. Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';

export function ConfirmAddress({ token }: { token: string }) {
    const t = useTranslations('intake.publicConfirm');
    const [state, setState] = useState<'idle' | 'sending' | 'done' | 'invalid' | 'failed'>('idle');

    const confirm = async () => {
        setState('sending');
        try {
            const res = await fetch('/api/intake/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'omit',
                body: JSON.stringify({ token }),
            });
            setState(res.ok ? 'done' : res.status === 404 ? 'invalid' : 'failed');
        } catch {
            setState('failed');
        }
    };

    return (
        <section aria-labelledby="confirm-heading" className="space-y-default">
            <h1 id="confirm-heading" className="text-xl font-semibold text-content-emphasis">
                {t('heading')}
            </h1>
            {state === 'done' ? (
                <p role="status" className="text-sm text-content-default">
                    {t('done')}
                </p>
            ) : state === 'invalid' ? (
                <p role="alert" className="text-sm text-content-error">
                    {t('invalid')}
                </p>
            ) : (
                <>
                    <p className="text-sm text-content-default">{t('body')}</p>
                    {state === 'failed' && (
                        <p role="alert" className="text-sm text-content-error">
                            {t('failed')}
                        </p>
                    )}
                    <Button type="button" variant="primary" loading={state === 'sending'} text={t('button')} onClick={confirm} />
                </>
            )}
        </section>
    );
}
