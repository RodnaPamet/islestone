/**
 * Work item keys: the project's current prefix, a hyphen and the item's
 * number, such as `ISL-123` (ADR 0002 §4, ADR 0006 "Key"). The number is
 * stored (`WorkItem.number`); the key string is not.
 *
 * `parseKey` follows Kaneo's key lookup (`apps/api/src/task/controllers/
 * get-task-by-ticket-id.ts` at fb890b4974e6dd6c232f1de6a6b70a591dfca0a3,
 * pattern only, no code copied): NFKC-normalise, match the prefix without
 * regard to case, and bound the number to a 32-bit integer so a long digit
 * string never reaches the database as a value the column cannot hold.
 *
 * Pure and client-safe.
 */

/** A prefix: a letter, then 1 to 9 letters or digits, upper case. */
export const KEY_PREFIX_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

/** The largest number a key may carry (Postgres `integer`). */
export const MAX_KEY_NUMBER = 2_147_483_647;

export function isValidKeyPrefix(prefix: string): boolean {
    return KEY_PREFIX_PATTERN.test(prefix);
}

/** `ISL-123`. */
export function formatKey(prefix: string, number: number): string {
    return `${prefix}-${number}`;
}

export interface ParsedKey {
    prefix: string;
    number: number;
}

/**
 * Parse `isl-123`, `ISL-123` or a full-width variant into `{ prefix: 'ISL',
 * number: 123 }`, or `null` when the text is not a key.
 */
export function parseKey(raw: string): ParsedKey | null {
    const text = raw.normalize('NFKC').trim();
    const m = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,10})$/.exec(text);
    if (!m) return null;
    const number = Number(m[2]);
    if (!Number.isSafeInteger(number) || number < 1 || number > MAX_KEY_NUMBER) return null;
    return { prefix: m[1]!.toUpperCase(), number };
}

/** NFKC + trim + upper case, for a prefix a person typed. */
export function normaliseKeyPrefix(raw: string): string {
    return raw.normalize('NFKC').trim().toUpperCase();
}
