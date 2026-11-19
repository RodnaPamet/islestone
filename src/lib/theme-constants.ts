import { uiStorageKey, uiCookieName } from '@/lib/ui-storage';
/**
 * Theme constants — SERVER-SAFE.
 *
 * This module MUST NOT carry a `'use client'` directive and MUST NOT import any
 * client-only module. The root layout (`src/app/layout.tsx`) is a SERVER
 * component and reads these to render `<html data-theme>` from the persisted
 * cookie and to build the anti-FOUC inline script.
 *
 * Why this file exists (load-bearing): these constants previously lived in
 * `ThemeProvider.tsx`, which is a `'use client'` module. When a server
 * component imports a value from a `'use client'` module, Next replaces the
 * export with a CLIENT REFERENCE PROXY — so on the server `THEME_COOKIE` was a
 * function, not the `THEME_COOKIE` string. That silently broke BOTH
 * `cookies().get(THEME_COOKIE)` (always undefined → SSR fell back to `dark`)
 * AND `JSON.stringify(THEME_STORAGE_KEY)` in the inline script (→ `undefined`
 * localStorage key) — which is why the theme flashed on every reload.
 *
 * Keep the literal values HERE; the client `ThemeProvider` re-exports them.
 */

export type Theme = 'dark' | 'light';

/**
 * The theme the server renders when no choice is stored. The browser then
 * follows the operating system (`SYSTEM_DARK_QUERY`) until the person picks
 * one; this is also the theme a browser with no `matchMedia` keeps.
 */
export const DEFAULT_THEME: Theme = 'light';

/** The media query that says the operating system prefers dark. */
export const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

/** localStorage key (legacy/back-compat mirror, client-only). */
export const THEME_STORAGE_KEY = uiStorageKey('theme');

/**
 * Cookie name — the flash-proof, server-readable channel. RFC6265 token (no
 * `:`), so it differs from THEME_STORAGE_KEY.
 */
export const THEME_COOKIE = uiCookieName('theme');

/** What `JSON.stringify` leaves raw that must not reach an inline <script>. */
const UNSAFE_SCRIPT_CHARS: Record<string, string> = {
    '<': '\\u003C',
    '>': '\\u003E',
    '\b': '\\b',
    '\f': '\\f',
    '\n': '\\n',
    '\r': '\\r',
    '\t': '\\t',
    '\0': '\\0',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
};

function escapeUnsafeChars(str: string): string {
    return str.replace(/[<>\b\f\n\r\t\0\u2028\u2029]/g, (x) => UNSAFE_SCRIPT_CHARS[x] ?? x);
}

/**
 * Anti-FOUC theme script, rendered by the root layout in `<head>` before the
 * body, so it runs before first paint.
 *
 * It resolves cookie → localStorage → the operating system's
 * `prefers-color-scheme` (dark when it asks for dark, else light) and sets
 * `data-theme`. It WRITES NOTHING. A theme is stored only when the user picks
 * one (`ThemeProvider`'s `setTheme` / `toggle`), never on a first visit and
 * never from the OS preference: reading `prefers-color-scheme` needs no
 * storage at all, and a UI-customisation cookie is exempt from consent only
 * when the user asked for the preference to be kept (Article 29 WP194).
 *
 * Following the OS until the person chooses is the owner's decision of
 * 2026-11-19 (docs/HANDOFF.md, row 38). The server renders the cookie's
 * theme, or light; for a visitor who never chose, this script switches to
 * the OS theme before the browser paints, so there is no flash.
 *
 * Lives here, not in `layout.tsx`, for two reasons. A layout may only export the
 * fields Next allows. And the script is code that runs in a browser, so
 * `tests/rendered/theme-storage-on-choice.test.tsx` executes it rather than
 * pattern-matching its source.
 *
 * The two names are embedded through `escapeUnsafeChars(JSON.stringify(…))`.
 * Both are compile-time constants with no unsafe character in them, so this
 * changes no byte of what ships. It keeps the construction sound if one of them
 * ever stops being a constant, because `JSON.stringify` alone leaves `<` intact,
 * and a `</script>` in an inlined string ends the element.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var d=document.documentElement;var ck=${escapeUnsafeChars(JSON.stringify(THEME_COOKIE))};var lk=${escapeUnsafeChars(JSON.stringify(THEME_STORAGE_KEY))};var t=null;var m=document.cookie.match(new RegExp('(?:^|;\\\\s*)'+ck+'=(light|dark)\\\\b'));if(m){t=m[1];}if(!t){var s=null;try{s=localStorage.getItem(lk);}catch(e){}if(s==='light'||s==='dark'){t=s;}}if(!t){t=(window.matchMedia&&window.matchMedia(${escapeUnsafeChars(JSON.stringify(SYSTEM_DARK_QUERY))}).matches)?'dark':'light';}d.setAttribute('data-theme',t);}catch(e){}})();`;
