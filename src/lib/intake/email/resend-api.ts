/**
 * Resend's receiving API, from the worker (sub-phase 2.6c, owner decision
 * 122): retrieve one received email by its id. A FIXED host
 * (`RESEND_API_ORIGIN`, a constant): no person configures it, so this is not a
 * `safeFetch` sink. The response's `download_url` is a third party's value
 * and is fetched only by `resend-download.ts`.
 *
 * The endpoint and the response shape come from Resend's documentation as
 * summarised by search, not from a live page: re-check against resend.com
 * before go-live. The parse is deliberately loose (unknown fields ignored, the
 * signed URL accepted at the top level or under `raw`), and every field it
 * relies on is checked.
 *
 * Server-only. Written fresh for Islestone (no Resend SDK).
 */
import { z } from 'zod';

import { env } from '@/env';
import { readCappedBody } from '@/lib/intake/public/capped-body';

export const RESEND_API_ORIGIN = 'https://api.resend.com';
/** The retrieve response is metadata and parsed text; anything larger is refused. */
export const RECEIVED_EMAIL_JSON_MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

const ReceivedEmailSchema = z
    .object({
        id: z.string().min(1),
        from: z.string().nullish(),
        subject: z.string().nullish(),
        message_id: z.string().nullish(),
        text: z.string().nullish(),
        html: z.string().nullish(),
        download_url: z.string().nullish(),
        raw: z.object({ download_url: z.string().nullish() }).partial().passthrough().nullish(),
        attachments: z.array(z.unknown()).nullish(),
    })
    .passthrough();

export interface ReceivedEmail {
    id: string;
    from: string | null;
    subject: string | null;
    messageId: string | null;
    text: string | null;
    html: string | null;
    downloadUrl: string | null;
    attachments: number;
}

/** A failure a retry cannot fix (missing key, unknown email, malformed answer). */
export class ResendTerminalError extends Error {
    constructor(readonly code: 'NO_API_KEY' | 'NOT_FOUND' | 'UNAUTHORISED' | 'MALFORMED', message: string) {
        super(message);
        this.name = 'ResendTerminalError';
    }
}

export async function retrieveReceivedEmail(emailId: string): Promise<ReceivedEmail> {
    const key = env.RESEND_API_KEY;
    if (!key) throw new ResendTerminalError('NO_API_KEY', 'RESEND_API_KEY is not set.');
    const res = await fetch(`${RESEND_API_ORIGIN}/emails/receiving/${encodeURIComponent(emailId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) throw new ResendTerminalError('NOT_FOUND', 'The received email is not known to Resend.');
    if (res.status === 401 || res.status === 403) throw new ResendTerminalError('UNAUTHORISED', 'Resend refused the API key.');
    if (!res.ok) throw new Error(`Resend answered ${res.status} for a received email.`);
    let json: unknown;
    try {
        json = JSON.parse(await readCappedBody(res, RECEIVED_EMAIL_JSON_MAX_BYTES));
    } catch {
        throw new ResendTerminalError('MALFORMED', 'Resend answered with something that is not JSON.');
    }
    const parsed = ReceivedEmailSchema.safeParse(json);
    if (!parsed.success) throw new ResendTerminalError('MALFORMED', 'Resend answered without the received email.');
    const d = parsed.data;
    return {
        id: d.id,
        from: d.from ?? null,
        subject: d.subject ?? null,
        messageId: d.message_id ?? null,
        text: d.text ?? null,
        html: d.html ?? null,
        downloadUrl: d.download_url ?? d.raw?.download_url ?? null,
        attachments: d.attachments?.length ?? 0,
    };
}
