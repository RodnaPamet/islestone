/**
 * Download a received email's raw `.eml` from the signed `download_url`
 * Resend's API returned (sub-phase 2.6c, owner decision 122).
 *
 * The URL is a third party's value, not one a person configured, but it is
 * still fetched as untrusted:
 *
 * - its host is pinned to `DOWNLOAD_HOST_SUFFIXES` (Resend's own domains and
 *   the AWS storage a signed object URL is served from; re-check against
 *   resend.com before go-live), https only, no credentials or port, so a
 *   tampered answer cannot point the worker anywhere else;
 * - it goes through `safeFetch` (private, loopback and metadata addresses
 *   refused, the DNS answer pinned), so even an allowed host that resolves
 *   inward is refused;
 * - the body is read through a capped stream (`RAW_EMAIL_MAX_BYTES`), never
 *   trusting a declared `size`;
 * - no credential is sent: the URL is signed.
 *
 * A refused host or an oversized message is not retried: the caller falls
 * back to the API's parsed text (`contentFromFields`), unauthenticated.
 * Server-only. Written fresh for Islestone.
 */
import { safeFetch } from '@/app-layer/automation/webhook-safety';
import { payloadTooLarge, readCappedBytes } from '@/lib/intake/public/capped-body';

export const DOWNLOAD_HOST_SUFFIXES = ['resend.com', 'resend.app', 'amazonaws.com'] as const;
export const RAW_EMAIL_MAX_BYTES = 10 * 1024 * 1024;

/** Whether `url` may be downloaded (the host allowlist and the URL's shape). */
export function downloadUrlAllowed(url: string): boolean {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return false;
    }
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    const host = u.hostname.toLowerCase();
    return DOWNLOAD_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

export type RawDownload = { ok: true; bytes: Uint8Array } | { ok: false; reason: 'HOST_REFUSED' | 'TOO_LARGE' | 'GONE' };

export async function downloadRawEmail(url: string): Promise<RawDownload> {
    if (!downloadUrlAllowed(url)) return { ok: false, reason: 'HOST_REFUSED' };
    const res = await safeFetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (res.status === 403 || res.status === 404 || res.status === 410) return { ok: false, reason: 'GONE' };
    if (!res.ok) throw new Error(`The raw email download answered ${res.status}.`);
    try {
        return { ok: true, bytes: await readCappedBytes(res, RAW_EMAIL_MAX_BYTES) };
    } catch (err) {
        if (err instanceof Error && err.message === payloadTooLarge(RAW_EMAIL_MAX_BYTES).message) return { ok: false, reason: 'TOO_LARGE' };
        throw err;
    }
}
