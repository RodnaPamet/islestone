/**
 * Is `islestone_bg_en` installed, and does it stem as pinned? (Sub-phase 2.7f;
 * ADR 0008 D2, "Fail closed"; owner decision 126.)
 *
 * One read: every fixture of `SEARCH_CONFIGURATION_FIXTURES` through
 * `to_tsvector('islestone_bg_en', …)`. A missing configuration or dictionary
 * is `missing` (the database refused the read); a dictionary that is not the
 * pinned one is `fixture_mismatch`. Run by the app and the worker at startup
 * in production (`src/instrumentation-node.ts`, `scripts/worker.ts`), which
 * refuse to start on a failure, and by `/api/readyz` on every probe.
 *
 * The caller passes its own query runner (the app's client, the worker's), so
 * this module holds no connection of its own. The driver's error message is
 * never returned: it can carry the host and the role.
 */
import { Prisma } from '@prisma/client';

import { judgeFixtureReadings, SEARCH_CONFIGURATION, SEARCH_CONFIGURATION_FIXTURES, type FixtureReading, type SearchConfigurationResult } from './configuration';

/** Runs one raw query and returns its rows. */
export type RawQueryRunner = (query: Prisma.Sql) => Promise<unknown>;

export async function checkSearchConfiguration(run: RawQueryRunner): Promise<SearchConfigurationResult> {
    const inputs = SEARCH_CONFIGURATION_FIXTURES.map(([input]) => input);
    let rows: unknown;
    try {
        rows = await run(Prisma.sql`
            SELECT f.input,
                   array_to_string(tsvector_to_array(to_tsvector(${SEARCH_CONFIGURATION}::regconfig, f.input)), ' ') AS got
              FROM unnest(${inputs}::text[]) AS f(input)`);
    } catch {
        return { ok: false, reason: 'missing', detail: `the text-search configuration ${SEARCH_CONFIGURATION} or its Bulgarian dictionary is not installed` };
    }
    if (!Array.isArray(rows)) return { ok: false, reason: 'missing', detail: 'the fixture read returned no rows' };
    return judgeFixtureReadings(rows as FixtureReading[]);
}

/** The startup refusal's sentence. */
export function searchConfigurationRefusal(result: Exclude<SearchConfigurationResult, { ok: true }>): string {
    return (
        `the full-text search configuration ${SEARCH_CONFIGURATION} failed its check (${result.reason}: ${result.detail}). ` +
        'The database must run Islestone\'s Postgres image (ghcr.io/rodnapamet/islestone-postgres, deploy/postgres/Dockerfile) ' +
        'and be migrated to 20261207120000_search_configuration; see docs/deployment.md, "The Postgres image".'
    );
}
