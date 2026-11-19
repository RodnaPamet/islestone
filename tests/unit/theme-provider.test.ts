/**
 * Epic 51 — theme provider + toggle contract.
 *
 * Jest runs under `testEnvironment: 'node'` so we cannot runtime-load
 * `ThemeProvider.tsx` (tsconfig `jsx: "preserve"`). This suite verifies the
 * observable contract by source inspection — the same pattern used by every
 * other React-layer test in the filter module.
 *
 * Guards:
 *   - ThemeProvider exports the documented hook + provider.
 *   - The storage key, attribute name, and fallback ordering are stable.
 *   - ThemeToggle renders a token-driven icon button with accessible labels.
 *   - The provider mounts inside `<Providers>` so every app page can call
 *     `useTheme()`.
 *   - globals.css carries the `.icon-btn` family and the glass surface. That
 *     stylesheet is read through `cssCodeOf`, not `codeOf`: CSS has no `//`,
 *     so the TypeScript lexer would have left every `/* … *\/` comment
 *     standing while reading as masked.
 *   - layout.tsx seeds `data-theme` from the persisted theme COOKIE so SSR
 *     and first paint agree without a client-script race (flash-proof);
 *     `light` is only the no-cookie first-visit fallback.
 */

import * as fs from 'fs';
import { functionBodyOf } from '../helpers/source-blocks';
import { DEFAULT_THEME, SYSTEM_DARK_QUERY, THEME_STORAGE_KEY, THEME_COOKIE } from '@/lib/theme-constants';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../');

import { codeOf, cssCodeOf } from '../helpers/source-blocks';

// #2246 Class A — the mask goes at the READ SEAM so an assertion cannot be
// satisfied by a comment instead of the code it names.
//
// ONE READER PER LANGUAGE, because a mask that lexes the wrong language is
// worse than no mask: it reads as masked at the call site while leaving every
// comment in place. `read` lexes TypeScript (`.ts`/`.tsx`); `readCss` lexes
// CSS, whose only comment form is `/* … */` — which is exactly why `codeOf`
// was the wrong tool for `globals.css` rather than merely an unnecessary one.
//
// This file's header used to say the `.css` masker did not exist and that the
// globals.css read stayed deliberately raw until it did. `cssCodeOf` (#2727)
// is that masker, so the last raw seam here is gone.
function read(rel: string): string {
    return codeOf(fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
}
function readCss(rel: string): string {
    return cssCodeOf(fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
}

describe('ThemeProvider — source contract', () => {
    const src = read('src/components/theme/ThemeProvider.tsx');
    const constants = read('src/lib/theme-constants.ts');

    it('is a client module with named exports (no default)', () => {
        expect(src).toMatch(/^'use client'/);
        expect(src).toMatch(/export function ThemeProvider/);
        expect(src).toMatch(/export function useTheme/);
        expect(src).not.toMatch(/^export default/m);
    });

    it('theme keys live in a SERVER-SAFE module (not this client one)', () => {
        // Load-bearing: the server layout imports these; defining them in a
        // 'use client' module hands the server a client-reference proxy, not
        // the string — the bug that broke the SSR cookie read + inline script.
        expect(constants).not.toMatch(/^\s*['"]use client['"]/m);
        // VALUES, not source spellings. These assertions used to regex the
        // constants file, which pinned one way of writing the key rather than
        // the key itself: it would fail on a refactor that preserved the value
        // exactly, and pass on a second constant that shadowed it with a
        // different one. The value is what addresses data already in real users'
        // browsers, so it is the thing worth pinning.
        expect(THEME_STORAGE_KEY).toBe('islestone:theme');
        expect(THEME_COOKIE).toBe('islestone_theme');
        // The provider imports + re-exports them for its client consumers.
        expect(src).toMatch(/from\s*['"]@\/lib\/theme-constants['"]/);
    });

    it('also persists to a cookie so SSR can render the theme flash-free', () => {
        // The cookie (server-readable) is what makes the layout flash-proof;
        // localStorage stays as a back-compat mirror.
        expect(src).toMatch(/document\.cookie\s*=\s*`\$\{THEME_COOKIE\}=/);
        expect(src).toMatch(/function persistTheme\b/);
    });

    it('flips the html[data-theme] attribute (not a class) so tokens.css matches', () => {
        expect(src).toMatch(/ATTR\s*=\s*['"]data-theme['"]/);
        expect(src).toMatch(/setAttribute\(ATTR/);
    });

    it('resolves initial theme in the documented order: cookie → storage → the OS', () => {
        // The provider builds this regex FROM `THEME_COOKIE` now, so asserting
        // the literal would assert the very drift this change removes. What
        // still matters is the ORDER — the cookie is consulted before storage,
        // because it is what SSR already used.
        //
        // BOUNDED to `readStoredTheme`, not measured across the file. The first
        // version of this assertion compared positions in the whole source and
        // was satisfied by the IMPORT LIST, where the two names appear in the
        // other order — it failed for a reason that had nothing to do with the
        // resolution order it claimed to check.
        const resolve = functionBodyOf(src, 'readStoredTheme');
        expect(resolve.indexOf('THEME_COOKIE')).toBeGreaterThanOrEqual(0);
        expect(resolve.indexOf('STORAGE_KEY')).toBeGreaterThanOrEqual(0);
        expect(resolve.indexOf('THEME_COOKIE')).toBeLessThan(resolve.indexOf('STORAGE_KEY'));
        expect(src).toMatch(/localStorage\.getItem\(STORAGE_KEY\)/);
        // With nothing stored the OS decides (owner decision, 2026-11-19);
        // light is the server's baseline and the no-matchMedia fallback.
        expect(DEFAULT_THEME).toBe('light');
        expect(src).toMatch(/const next = stored \?\? systemTheme\(\)/);
        expect(src).toMatch(/matchMedia\?\.\(SYSTEM_DARK_QUERY\)/);
        expect(SYSTEM_DARK_QUERY).toBe('(prefers-color-scheme: dark)');
    });

    it('`useTheme()` is safe outside a provider (SSR-friendly no-op fallback)', () => {
        // The fallback branch returns a value object with a no-op setter.
        expect(src).toMatch(/setTheme:\s*\(\)\s*=>\s*\{\}/);
        expect(src).toMatch(/toggle:\s*\(\)\s*=>\s*\{\}/);
    });

    it('tolerates localStorage throwing (private/sandboxed contexts)', () => {
        // The module wraps both read and write in try/catch.
        expect(src).toMatch(/catch\s*\{/);
    });
});

describe('ThemeToggle — accessible control', () => {
    const src = read('src/components/theme/ThemeToggle.tsx');

    it('is a client button with aria-label and aria-pressed', () => {
        expect(src).toMatch(/^'use client'/);
        expect(src).toMatch(/aria-label=/);
        expect(src).toMatch(/aria-pressed=/);
    });

    it('swaps the Sun/Moon icon based on the active theme', () => {
        // The component imports both icons from lucide-react and renders one
        // based on the `theme` state. Match both symbols anywhere in the file.
        expect(src).toMatch(/\bSun\b/);
        expect(src).toMatch(/\bMoon\b/);
        expect(src).toMatch(/lucide-react/);
    });

    it('uses the shared .icon-btn token-driven class', () => {
        expect(src).toMatch(/icon-btn/);
    });

    it('carries a deterministic id default and a testid for E2E', () => {
        expect(src).toMatch(/id:\s*string|id\?:\s*string/);
        expect(src).toMatch(/data-testid=["']theme-toggle["']/);
    });
});

describe('Providers wiring — ThemeProvider mounts inside the app shell', () => {
    const providers = read('src/app/providers.tsx');
    it('wraps the NextAuth session boundary', () => {
        expect(providers).toMatch(/from ['"]@\/components\/theme\/ThemeProvider['"]/);
        expect(providers).toMatch(/<ThemeProvider\b/);
    });

    it('root layout seeds data-theme from the persisted cookie (light fallback)', () => {
        const layout = read('src/app/layout.tsx');
        // Flash-proof: SSR data-theme comes from the cookie, not a hardcoded
        // value; the default is only the no-cookie (first-visit) fallback.
        expect(layout).toMatch(/data-theme=\{initialTheme\}/);
        expect(layout).toMatch(/cookies\(\)\)\.get\(THEME_COOKIE\)/);
        expect(layout).toMatch(/:\s*DEFAULT_THEME;/); // ternary fallback
    });
});

describe('globals.css — the shell\'s icon buttons and glass surfaces', () => {
    const src = readCss('src/app/globals.css');

    it('defines the .icon-btn family the shell\'s icon buttons use', () => {
        // ThemeToggle, the sidebar's settings and sign-out buttons carry
        // `icon-btn icon-btn-sm`; without the recipe they render unstyled
        // and below the touch-target floor.
        expect(src).toMatch(/^\s*\.icon-btn\s*\{/m);
        expect(src).toMatch(/^\s*\.icon-btn-sm\s*\{/m);
        expect(src).toMatch(/^\s*\.icon-btn:focus-visible\s*\{/m);
    });

    it('.glass-card picks up --glass-bg / --glass-border so theme toggle flips glass too', () => {
        expect(src).toMatch(/\.glass-card[^}]*background:\s*var\(--glass-bg\)/);
        expect(src).toMatch(/\.glass-card[^}]*border:\s*1px solid var\(--glass-border\)/);
    });
});
