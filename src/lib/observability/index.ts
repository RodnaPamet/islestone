/**
 * Observability barrel — SUB-PHASE 1.4 STUB at the final module path.
 *
 * Sub-phase 1.6 brings inflect-compliance's full barrel (tracing, metrics,
 * Sentry) and replaces this file. Until then it re-exports the logger and
 * the request context that 1.3 pulled forward, which is all the 1.4 code
 * imports from it (docs/porting/maps/1.4.md, "Import closure", 1.6 rows).
 * Tests that `jest.mock('@/lib/observability')` need the path to exist.
 */
export { logger, log, createChildLogger, extractErrorMeta } from './logger';
export type { LogLevel, LogFields } from './logger';
export * from './context';
