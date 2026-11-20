/**
 * How a search query becomes SQL parameters (sub-phase 2.7b, docs/search.md).
 *
 * Pure and client-safe. The query is always a bind parameter; these helpers
 * only shape it. `ILIKE`'s escape character is PostgreSQL's default, the
 * backslash, so a typed `%`, `_` or `\` matches itself rather than acting as
 * a wildcard.
 *
 * Written fresh for Islestone.
 */

import { MAX_QUERY_LENGTH } from './types';

/** The most rows one repository search read returns, whatever the caller asks. */
export const SEARCH_ROW_CAP = 100;

/** Escape `\`, `%` and `_` for a `LIKE`/`ILIKE` pattern. */
export function escapeLike(text: string): string {
    return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** `%text%`, escaped: a substring match. */
export function containsPattern(text: string): string {
    return `%${escapeLike(text)}%`;
}

/** `text%`, escaped: a prefix match. */
export function prefixPattern(text: string): string {
    return `${escapeLike(text)}%`;
}

/** Trim and cap a raw query; `''` when nothing is left. */
export function normaliseSearchQuery(raw: string | null | undefined): string {
    return (raw ?? '').trim().slice(0, MAX_QUERY_LENGTH).trim();
}
