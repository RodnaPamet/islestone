/**
 * The expected version of a work item from its `If-Match` header (ADR 0002
 * §9). Accepts `3`, `"3"` and the weak form `W/"3"`; absent is `undefined`
 * (the write is then last-writer-wins, which the usecase allows only for a
 * single-field change). Anything else is a 400.
 */
import { badRequest } from '@/lib/errors/types';

export function expectedVersionFrom(req: Request): number | undefined {
    const raw = req.headers.get('if-match');
    if (raw === null || raw.trim() === '') return undefined;
    const m = /^\s*(?:W\/)?"?(\d{1,9})"?\s*$/.exec(raw);
    if (!m) throw badRequest('If-Match must carry the version number you edited, such as "3".');
    const version = Number(m[1]);
    if (version < 1) throw badRequest('If-Match must carry a version of 1 or more.');
    return version;
}
