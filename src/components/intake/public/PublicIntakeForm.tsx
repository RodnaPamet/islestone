'use client';

/**
 * A public intake form's page body (sub-phase 2.6b; owner decisions 88 and
 * 89): the form's own published text and fields, rendered by the same
 * component as the members' form and the builder's preview, then the success
 * screen with the short reference and the form's confirmation text.
 *
 * While the person types, the page solves the proof-of-work bound to its
 * signed form token (`solveProofOfWork`, WebCrypto's SHA-256, in batches that
 * yield to the page; no script from another host, so the Content-Security-
 * Policy is unchanged). Sending waits for it if it is not done yet. Nothing
 * here reads a session or names the workspace.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { IntakeFormRenderer } from '@/components/intake/IntakeFormRenderer';
import type { IntakeFormDefinition, PublicIntakeRequestInput } from '@/lib/intake/form-definition';
import { solveProofOfWork } from '@/lib/intake/pow';

type Updates = 'NONE' | 'CONFIRM_PENDING' | 'CONFIRMED';
interface Receipt {
    reference: string;
    confirmation: string;
    updates: Updates;
}

async function sha256(input: string): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
}

export function PublicIntakeForm({ publicId, name, definition, token }: { publicId: string; name: string; definition: IntakeFormDefinition; token: string }) {
    const t = useTranslations('intake.publicForm');
    const [receipt, setReceipt] = useState<Receipt | null>(null);
    const proof = useRef<Promise<number | null> | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        proof.current = solveProofOfWork(token, sha256, { signal: controller.signal });
        return () => controller.abort();
    }, [token]);

    const send = async (input: PublicIntakeRequestInput, extra: { website: string }): Promise<string | null> => {
        const solved = await (proof.current ?? solveProofOfWork(token, sha256));
        if (solved === null) return t('failed');
        let res: Response;
        try {
            res = await fetch(`/api/intake/forms/${encodeURIComponent(publicId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'omit',
                body: JSON.stringify({ token, proof: solved, website: extra.website, request: input }),
            });
        } catch {
            return t('failed');
        }
        if (res.ok) {
            setReceipt((await res.json()) as Receipt);
            return null;
        }
        const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
        const code = body?.error?.code;
        if (res.status === 429) return t('resting');
        if (code === 'FORM_CHANGED' || code === 'FORM_ALREADY_SENT' || code === 'FORM_TOKEN_REFUSED') return t('reload');
        if (res.status === 400 && body?.error?.message) return body.error.message;
        return t('failed');
    };

    if (receipt) {
        return (
            <section aria-labelledby="public-intake-sent" className="space-y-default">
                <h2 id="public-intake-sent" className="text-lg font-semibold text-content-emphasis">
                    {t('sent')}
                </h2>
                {receipt.confirmation && <p className="whitespace-pre-wrap text-sm text-content-default">{receipt.confirmation}</p>}
                <p className="text-sm text-content-muted">{t('reference', { reference: receipt.reference })}</p>
                {receipt.updates === 'CONFIRM_PENDING' && <p className="text-sm text-content-default">{t('confirmPending')}</p>}
                {receipt.updates === 'CONFIRMED' && <p className="text-sm text-content-default">{t('confirmed')}</p>}
            </section>
        );
    }

    return (
        <section aria-labelledby="public-intake-name" className="space-y-default">
            <h1 id="public-intake-name" className="text-xl font-semibold text-content-emphasis">
                {name}
            </h1>
            <IntakeFormRenderer definition={definition} formKey={publicId} requester={definition.requester} onSubmit={send} />
        </section>
    );
}
