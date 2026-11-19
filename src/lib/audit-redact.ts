/**
 * Redaction for audit payloads: what an audit row may record about a write.
 *
 * The Prisma audit extension (`src/lib/prisma.ts`) records the fields a
 * write named and, where it can, their values before and after. Those values
 * pass through here first, so an audit row never stores a secret, never
 * stores a document body, and never grows without bound:
 *
 *   - a field whose NAME is secret-shaped (password, token, API key, secret,
 *     credential, authorisation, private or encryption key, cookie, salt,
 *     SSN) becomes `[REDACTED]`;
 *   - a long string (over 2 KB), or any value of a body-shaped field
 *     (`contentText`, `bodyHtml` …), becomes `[BLOB len=N sha256=<prefix>...]`,
 *     which still lets a reader tell whether two versions differ;
 *   - nesting is cut below depth 3 (`{ _truncated: true }`), arrays are
 *     summarised as `[Array len=N]`, dates become ISO strings, and keys that
 *     start with `_` (Prisma's `_count` and friends) are dropped.
 *
 * Written fresh for Islestone. inflect-compliance re-exports these four
 * functions from its `@rodnapamet/scanent-contract` package, which Islestone
 * does not take (docs/porting/maps/1.5.md); the contract is the one
 * `tests/unit/audit-trail-redact.test.ts` pins.
 *
 * Redaction is by NAME and SIZE. It does not know which columns the field
 * encryption manifest covers: the audit extension keeps those out of
 * `diffJson` itself (`buildDiffJson`, `undiffableFields`).
 *
 * Uses Node `crypto`, so it is server only.
 */
import { createHash } from 'node:crypto';

/** Strings longer than this are summarised rather than stored. */
const BLOB_THRESHOLD = 2048;

/** Nesting below this depth is cut. */
const MAX_DEPTH = 3;

/** How much of the SHA-256 a blob summary keeps. */
const HASH_PREFIX_LENGTH = 16;

/**
 * Fragments of a field name that mark it as secret. Matched against the name
 * lower-cased with `_` and `-` removed, so `access_token`, `accessToken` and
 * `ACCESS-TOKEN` are one name.
 */
const SENSITIVE_FRAGMENTS: readonly string[] = [
    'password',
    'passwd',
    'token',
    'apikey',
    'secret',
    'credential',
    'authorization',
    'privatekey',
    'encryptionkey',
    'cookie',
];

/** Names that are secret only as a whole word (`salt` inside a longer name is not). */
const SENSITIVE_EXACT: ReadonlySet<string> = new Set(['salt', 'ssn']);

/** Fields that hold a document body: always summarised, whatever their length. */
const BLOB_FIELDS: ReadonlySet<string> = new Set([
    'contenttext',
    'contenthtml',
    'bodyhtml',
    'bodytext',
    'html',
]);

function normaliseName(field: string): string {
    return field.toLowerCase().replace(/[_-]/g, '');
}

/** True when a field's name marks its value as a secret. */
export function isSensitiveField(field: string): boolean {
    const name = normaliseName(field);
    if (SENSITIVE_EXACT.has(name)) return true;
    return SENSITIVE_FRAGMENTS.some((fragment) => name.includes(fragment));
}

/** True when a field's name marks its value as a document body. */
export function isBlobField(field: string): boolean {
    return BLOB_FIELDS.has(normaliseName(field));
}

function summariseBlob(value: string): string {
    const digest = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, HASH_PREFIX_LENGTH);
    return `[BLOB len=${value.length} sha256=${digest}...]`;
}

function redactValue(field: string, value: unknown, depth: number): unknown {
    if (value === null || value === undefined) return value;
    if (isSensitiveField(field)) return '[REDACTED]';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') {
        return isBlobField(field) || value.length > BLOB_THRESHOLD ? summariseBlob(value) : value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) return `[Array len=${value.length}]`;
    if (typeof value === 'object') {
        if (depth >= MAX_DEPTH) return { _truncated: true };
        return redactObject(value as Record<string, unknown>, depth + 1);
    }
    // Functions and symbols carry nothing an audit row should hold.
    return undefined;
}

function redactObject(input: Record<string, unknown>, depth: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
        if (key.startsWith('_')) continue;
        out[key] = redactValue(key, value, depth);
    }
    return out;
}

/**
 * A copy of `data` that is safe to store in an audit row. `null` in (or
 * `undefined`) is `null` out.
 */
export function redactSensitiveFields(
    data: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
    if (data === null || data === undefined) return null;
    return redactObject(data, 0);
}

/** The field names a write payload named, without Prisma's `_`-prefixed internals. */
export function extractChangedFields(data: Record<string, unknown> | null | undefined): string[] {
    if (data === null || data === undefined) return [];
    return Object.keys(data).filter((key) => !key.startsWith('_'));
}
