/**
 * The text-search configuration every full-text index and query uses
 * (sub-phase 2.7f; ADR 0008 D2; owner decision 126; docs/search.md).
 *
 * `islestone_bg_en` is created by migration
 * `20261207120000_search_configuration`: Latin words through PostgreSQL's
 * `english_stem`, other-letter words (Cyrillic, accented Latin) through the
 * bgOffice Bulgarian Hunspell dictionary that only Islestone's Postgres image
 * carries (deploy/postgres/Dockerfile), then `simple`. No code names another
 * configuration and nothing falls back to `simple` or `english` when the
 * dictionary is missing: the migration, the startup checks and `/api/readyz`
 * refuse instead (`checkSearchConfiguration`).
 *
 * Pure: no database access here, so the guards and unit tests can read it.
 * Written fresh for Islestone.
 */

/** The one configuration. A different value is a revision and a rebuild, never a fallback. */
export const SEARCH_CONFIGURATION = 'islestone_bg_en' as const;

/**
 * The build revision of every stored vector (`SearchVector.revision`). Bump it
 * when the configuration, its dictionary or `searchableText` changes: the
 * nightly `search-index-rebuild` job rewrites every row below it.
 */
export const SEARCH_VECTOR_REVISION = 1;

/**
 * The most characters of one text that are vectorised: a description's own
 * cap (`Description` in src/lib/schemas/work-item.ts), so the vector stays far
 * below PostgreSQL's one-megabyte `tsvector` limit.
 */
export const MAX_VECTORISED_LENGTH = 100_000;

/**
 * Words and the lexeme each must stem to. The migration asserts the same list
 * (tests/unit/search/search-configuration.test.ts holds the two equal); the
 * app and the worker run it at startup in production, and `/api/readyz` on
 * every probe. A Bulgarian inflection that stems to its lemma proves the
 * pinned dictionary is loaded; an English word proves `english_stem`; an
 * unknown Cyrillic word proves the `simple` fallthrough of the mapping.
 */
export const SEARCH_CONFIGURATION_FIXTURES: ReadonlyArray<readonly [input: string, lexeme: string]> = [
    ['книгите', 'книга'],
    ['задачата', 'задача'],
    ['задачи', 'задача'],
    ['проектите', 'проект'],
    ['коментарите', 'коментар'],
    ['потребителите', 'потребител'],
    ['сроковете', 'срок'],
    ['срокът', 'срок'],
    ['въпросите', 'въпрос'],
    ['отговорът', 'отговор'],
    ['работихме', 'работя'],
    ['държавата', 'държава'],
    ['Задачата', 'задача'],
    ['running', 'run'],
    ['tests', 'test'],
    ['fixing', 'fix'],
    ['щъркелоподобни', 'щъркелоподобни'],
];

/** A mention token (`<@userId>`, 2.7d): names a person, never searchable text. */
const MENTION_TOKEN = /<@[^<>\s]{1,80}>/g;

/**
 * The text a vector is built from: the sanitised plaintext without mention
 * tokens (a user id is not a word anybody searches for, and a person's id must
 * not become a lexeme), capped at {@link MAX_VECTORISED_LENGTH}. `''` when
 * nothing is left, which the repository treats as "no vector".
 */
export function searchableText(text: string | null | undefined): string {
    if (!text) return '';
    return text.slice(0, MAX_VECTORISED_LENGTH).replace(MENTION_TOKEN, ' ').trim();
}

/** One fixture as the database answered it. */
export interface FixtureReading {
    input: string;
    /** The lexemes, space-joined, or `null` when the database gave none. */
    got: string | null;
}

export type SearchConfigurationResult =
    | { ok: true }
    | { ok: false; reason: 'missing' | 'fixture_mismatch'; detail: string };

/**
 * Judge the database's answers against the fixtures: every fixture must be
 * read back, and each must stem to its lexeme.
 */
export function judgeFixtureReadings(readings: readonly FixtureReading[]): SearchConfigurationResult {
    const byInput = new Map(readings.map((r) => [r.input, r.got]));
    for (const [input, lexeme] of SEARCH_CONFIGURATION_FIXTURES) {
        const got = byInput.get(input);
        if (got !== lexeme) {
            return {
                ok: false,
                reason: 'fixture_mismatch',
                detail: `"${input}" stems to ${got === undefined || got === null ? 'nothing' : `"${got}"`}, expected "${lexeme}"`,
            };
        }
    }
    return { ok: true };
}
