import { uiCookieName } from '@/lib/ui-storage';

/**
 * Locale constants — SERVER-SAFE.
 *
 * Mirrors `src/lib/theme-constants.ts`: this module MUST NOT carry a
 * `'use client'` directive and MUST NOT import any client-only module. It is
 * read by SERVER surfaces — the next-intl request config (`src/i18n/request.ts`) and
 * the `<html lang>` in the root layout — as well as by the client
 * `<LocaleSwitcher>`. Keeping the literal values here (not in a `'use client'`
 * module) avoids the client-reference-proxy trap documented in
 * `theme-constants.ts`, where a server component importing from a client module
 * receives a function proxy instead of the string value.
 *
 * The UI locale is a per-browser preference persisted in a first-party cookie
 * (`LOCALE_COOKIE`), read server-side in `getRequestConfig` so the FIRST SSR
 * byte is already in the chosen language — no client round-trip, no flash.
 */

/**
 * Every locale the UI ships a message catalog for (`messages/<locale>.json`).
 * Islestone is English-only (roadmap 1.7); a second locale is an owner
 * decision, and adding one here is all the switcher needs.
 */
export const SUPPORTED_LOCALES = ['en'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Fallback when no cookie is set or the cookie value is unrecognised. */
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Cookie name — the server-readable channel that drives `getRequestConfig`.
 * RFC6265 token (no `:`), built through the UI-storage seam like
 * `THEME_COOKIE`, so it reads `islestone_locale`.
 */
export const LOCALE_COOKIE = uiCookieName('locale');

/**
 * Full endonyms — each language named in its OWN language (standard i18n
 * practice), so these are NOT translated through the catalog.
 *
 * These are no longer the VISIBLE label: the switcher shows the short code
 * from `LOCALE_SHORT_LABELS` and renders the endonym `sr-only`, so it stays
 * the ACCESSIBLE NAME of each radio. A two-letter visible label would
 * otherwise leave assistive tech announcing "EN" / "БГ".
 */
export const LOCALE_LABELS: Record<Locale, string> = {
    en: 'English',
};

/**
 * Short codes shown in the language switcher.
 *
 * Authored UPPERCASE deliberately: the ToggleGroup option carries
 * `capitalize`, which uppercases only the first letter of a word — a
 * lowercase 'en' would render as 'En'. `i18n-locale-infrastructure.test.ts`
 * asserts the uppercase invariant so a future edit cannot reintroduce that.
 */
export const LOCALE_SHORT_LABELS: Record<Locale, string> = {
    en: 'EN',
};

/** Type guard: is `value` one of the supported locales? */
export function isSupportedLocale(value: unknown): value is Locale {
    return (
        typeof value === 'string' &&
        (SUPPORTED_LOCALES as readonly string[]).includes(value)
    );
}

/** Coerce an arbitrary cookie/input value to a supported locale (default fallback). */
export function resolveLocale(value: unknown): Locale {
    return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}
