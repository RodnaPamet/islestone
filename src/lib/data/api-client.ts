/**
 * The workspace client's fetch wrapper: one error type for every non-2xx
 * answer, read from the API envelope `{ error: { code, message, requestId,
 * details } }` (`src/lib/errors/types.ts`), and the session-expiry seam on
 * every failure.
 *
 * Copied from inflect-compliance `src/lib/api-client.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 2.3) and edited:
 * `ApiClientError`, `handleErrorResponse` and `apiGet` are kept; the per-verb
 * helpers (`apiPost`, `apiPatch`, `apiDelete`) became one `apiSend` that can
 * carry `If-Match` (ADR 0002 §9: a work item's title or description edit
 * names the version it edited); the development-only response validation
 * (`validateIfDev`, which logged through `console`) is cut. A 409's
 * `details` carry `reason`, and for a version conflict the current `version`
 * and `item`, which the work-item mutations read.
 */
import { noteUnauthorized } from '@/lib/auth/session-expiry';

/** A non-2xx answer from the API, with the envelope's fields. */
export class ApiClientError extends Error {
    public readonly code: string;
    public readonly status: number;
    public readonly details?: unknown;
    public readonly requestId?: string;
    public readonly reason?: string;

    constructor(message: string, code: string, status: number, details?: unknown, requestId?: string, reason?: string) {
        super(message);
        this.name = 'ApiClientError';
        this.code = code;
        this.status = status;
        this.details = details;
        this.requestId = requestId;
        this.reason = reason;
    }

    /** The refusal's machine reason (`details.reason`), when the server named one. */
    get refusalReason(): string | undefined {
        const d = this.details;
        if (d && typeof d === 'object' && 'reason' in d && typeof (d as { reason: unknown }).reason === 'string') {
            return (d as { reason: string }).reason;
        }
        return undefined;
    }
}

async function handleErrorResponse(res: Response): Promise<never> {
    let code = 'UNKNOWN';
    let message = `Request failed with status ${res.status}`;
    let details: unknown;
    let requestId: string | undefined;
    let reason: string | undefined;

    try {
        const body: unknown = await res.json();
        const envelope = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
        if (typeof envelope === 'object' && envelope !== null) {
            const fields = envelope as Record<string, unknown>;
            // A blank string is absent, not a message (inflect #3984).
            const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);
            code = text(fields.code) ?? code;
            reason = text(fields.message);
            message = reason ?? message;
            requestId = text(fields.requestId);
            details = fields.details;
        }
    } catch {
        // A body that is not JSON keeps the status-only message.
    }

    noteUnauthorized(res.status, res.url);

    throw new ApiClientError(message, code, res.status, details, requestId, reason);
}

/** GET a JSON body; a non-2xx answer throws `ApiClientError`. */
export async function apiGet<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, { method: 'GET', ...init });
    if (!res.ok) await handleErrorResponse(res);
    return (await res.json()) as T;
}

export interface ApiSendOptions {
    /** The version the write was based on, sent as `If-Match: "<n>"`. */
    ifMatch?: number;
    signal?: AbortSignal;
}

/**
 * POST, PATCH or DELETE with an optional JSON body. Returns the parsed body,
 * or `undefined` for an empty answer. A non-2xx answer throws
 * `ApiClientError`.
 */
export async function apiSend<T = unknown>(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
    options: ApiSendOptions = {},
): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.ifMatch !== undefined) headers['If-Match'] = `"${options.ifMatch}"`;
    const res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: options.signal,
    });
    if (!res.ok) await handleErrorResponse(res);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
}
