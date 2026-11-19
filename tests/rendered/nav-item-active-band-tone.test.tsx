/** @jest-environment jsdom */

/**
 * Behavioural (Tier-2) test — sidebar `<NavItem>` ACTIVE band tone.
 *
 * Copied from inflect-compliance at 5528464fc54a8681956f3b9ce23ca9c075f0420e
 * (sub-phase 1.7): the theme blocks are Islestone's (`[data-theme="dark"]`
 * and the light `:root, [data-theme="light"]`), and the page tone is read
 * from tokens.css rather than spelled as a hex, because Islestone's palette
 * is a placeholder (an owner decision still to take).
 *
 * What went wrong before:
 *   R13-PR4 (#394) tried to swap the active band to a secondary brand
 *   ramp; the 2026-05-13 v1 (#455) then tried to swap it to the page
 *   background. v1 used Tailwind utility overrides
 *   (`before:from-[var(--bg-page)]!` etc.). Those utilities only set
 *   the `--tw-gradient-from/via/to` CSS variables — they do NOT
 *   override the BASE recipe's literal arbitrary `before:bg-[...]`
 *   value. So the structural ratchet was GREEN (the `--bg-page` token
 *   string was present in `className`) while the RENDERED band still
 *   painted the brand-default ramp. v2 (#463) fixed it by overriding
 *   the entire arbitrary `before:bg-[...]` value.
 *
 * Why this is a Tier-2 test and not a `getComputedStyle(el,'::before')`
 * test (the audit's original sketch):
 *   jsdom does NOT compute pseudo-element styles — verified
 *   2026-05-22, `getComputedStyle(el, '::before')` returns empty
 *   strings. The audit's sketch is aspirational; it cannot run in
 *   jsdom. See `docs/frontend-assurance-model.md`.
 *
 * What this test does instead — same INTENT, achievable in jsdom:
 *   1. Extracts the `before:bg-[...]` arbitrary value that the ACTIVE
 *      recipe actually applies to the rendered `<a>` element.
 *   2. Resolves the CSS custom properties inside it against the REAL
 *      theme blocks in `src/styles/tokens.css` (both dark and light).
 *   3. Asserts the active band's gradient stops resolve to the
 *      page-background colour — and carry ZERO brand-ramp tokens.
 *
 * Step 3 is the assertion v1 would have FAILED: v1's rendered band
 * still contained `var(--brand-default)` / `--brand-muted` /
 * `--brand-emphasis`. This test is behavioural — it inspects the
 * value the component renders and resolves it, not merely a substring
 * presence.
 */

import fs from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import { Settings } from 'lucide-react';
import * as React from 'react';

import { NavItem } from '@/components/layout/nav-item';

// ─── Theme-token resolver ──────────────────────────────────────────
//
// jsdom does not substitute `var(--x)`. We parse the real
// `tokens.css` ourselves so the test resolves against the SAME values
// the app ships.

const TOKENS_CSS = fs.readFileSync(
    path.join(process.cwd(), 'src/styles/tokens.css'),
    'utf8',
);

/**
 * Parse a single theme block (`:root { ... }` or
 * `[data-theme="light"] { ... }`) into a `--token → value` map. Only
 * the FIRST occurrence of each block is read — that is the canonical
 * theme block; later occurrences in the file are sub-scope mirrors.
 */
function parseThemeBlock(selector: string): Record<string, string> {
    const start = TOKENS_CSS.indexOf(selector + ' {');
    if (start === -1) {
        throw new Error(`theme block ${selector} not found in tokens.css`);
    }
    // Walk braces to find the matching close.
    let depth = 0;
    let i = TOKENS_CSS.indexOf('{', start);
    const bodyStart = i + 1;
    for (; i < TOKENS_CSS.length; i++) {
        if (TOKENS_CSS[i] === '{') depth++;
        else if (TOKENS_CSS[i] === '}') {
            depth--;
            if (depth === 0) break;
        }
    }
    const body = TOKENS_CSS.slice(bodyStart, i);
    const map: Record<string, string> = {};
    for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
        // First write wins — top-level declarations precede the
        // nested sub-scope mirrors inside the same block.
        if (!(m[1] in map)) map[m[1]] = m[2].trim();
    }
    return map;
}

const METRO = parseThemeBlock('[data-theme="dark"]');
const LIGHT = parseThemeBlock('[data-theme="light"]');

/** Recursively substitute every `var(--x)` against a token map. */
function resolveVars(value: string, tokens: Record<string, string>): string {
    let out = value;
    for (let pass = 0; pass < 10 && out.includes('var('); pass++) {
        out = out.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
            return tokens[name] ?? `__UNRESOLVED(${name})__`;
        });
    }
    return out;
}

/**
 * Pull a `before:bg-[...]` arbitrary value (the band's
 * background-image) out of a className string. Tailwind's arbitrary
 * value escapes spaces as `_`; we un-escape them so `var()` parsing
 * is straightforward.
 *
 * A NavItem className can carry TWO such values:
 *   - the BASE band (brand ramp), applied in every state;
 *   - the ACTIVE override (`...!` important suffix), applied only on
 *     the active row.
 * `which: 'active'` returns the `!`-suffixed override; `'base'`
 * returns the non-suffixed BASE value. The arbitrary value itself
 * contains no `[`/`]` (gradients use only parens), so a
 * `[^\]]+` bracket match is exact.
 */
function extractBeforeBg(
    className: string,
    which: 'active' | 'base',
): string {
    const re =
        which === 'active'
            ? /before:bg-\[([^\]]+)\]!/g
            : /before:bg-\[([^\]]+)\](?!!)/g;
    const matches = [...className.matchAll(re)];
    if (matches.length === 0) {
        throw new Error(
            `no ${which} before:bg-[...] found in className`,
        );
    }
    return matches[0][1].replace(/_/g, ' ');
}

describe('<NavItem> active band tone — behavioural (Tier 2)', () => {
    it('the active band exists as a `before:bg-[...]` arbitrary value (not utility overrides)', () => {
        // v1's failure mode was using `before:from-X!` UTILITY classes
        // which silently no-op against an arbitrary `before:bg-[...]`.
        // The fix (v2) overrides the whole arbitrary value. This test
        // locks that the active band is expressed as a full arbitrary
        // value — the only form that actually overrides the BASE band.
        render(
            <NavItem
                href="/t/acme/projects"
                icon={Settings}
                label="Projects"
                active
            />,
        );
        const link = screen.getByRole('link', { name: 'Projects' });
        // The arbitrary-value override must be present...
        expect(() =>
            extractBeforeBg(link.className, 'active'),
        ).not.toThrow();
        // ...and it must carry the `!` important suffix, because both
        // the BASE band and the active override compile to the same
        // `background-image` property — without `!` the cascade is a
        // coin-flip and v1's brand ramp can win.
        expect(link.className).toMatch(/before:bg-\[[^\]]+\]!/);
    });

    it('the rendered active band resolves to --bg-page on the dark theme', () => {
        render(
            <NavItem
                href="/t/acme/projects"
                icon={Settings}
                label="Projects"
                active
            />,
        );
        const link = screen.getByRole('link', { name: 'Projects' });
        const bandValue = extractBeforeBg(link.className, 'active');

        const resolved = resolveVars(bandValue, METRO);

        // The page-background colour MUST appear in the resolved band.
        const page = METRO['--bg-page'];
        expect(page).toMatch(/^#[0-9a-f]{6}$/i);
        expect(resolved).toContain(page);
        // Nothing should be left unresolved.
        expect(resolved).not.toContain('__UNRESOLVED');
    });

    it('the rendered active band resolves to --bg-page on the light theme', () => {
        render(
            <NavItem
                href="/t/acme/projects"
                icon={Settings}
                label="Projects"
                active
            />,
        );
        const link = screen.getByRole('link', { name: 'Projects' });
        const bandValue = extractBeforeBg(link.className, 'active');

        const resolved = resolveVars(bandValue, LIGHT);

        const page = LIGHT['--bg-page'];
        expect(page).toMatch(/^#[0-9a-f]{6}$/i);
        expect(page).not.toBe(METRO['--bg-page']);
        expect(resolved).toContain(page);
        expect(resolved).not.toContain('__UNRESOLVED');
    });

    it('the rendered active band carries ZERO brand-ramp tokens — the exact v1 regression', () => {
        // THIS is the assertion v1 (#455) would have failed. v1 left
        // the BASE recipe's `linear-gradient(..., var(--brand-default),
        // var(--brand-muted), var(--brand-emphasis))` intact in the
        // rendered band because the utility overrides didn't touch the
        // arbitrary value. A structural "contains --bg-page" scan was
        // green; the band still painted brand yellow.
        render(
            <NavItem
                href="/t/acme/projects"
                icon={Settings}
                label="Projects"
                active
            />,
        );
        const link = screen.getByRole('link', { name: 'Projects' });
        const bandValue = extractBeforeBg(link.className, 'active');

        // The band's linear-gradient stops must NOT reference the
        // brand ramp. The radial "stardust particle" layers are pure
        // white rgba and carry no brand tokens, so the only brand
        // tokens that could appear here would be a leftover ramp.
        expect(bandValue).not.toContain('var(--brand-default)');
        expect(bandValue).not.toContain('var(--brand-muted)');
        expect(bandValue).not.toContain('var(--brand-emphasis)');

        // And it positively IS the page-bg ramp: three identical
        // `--nav-band-active` stops collapse the linear gradient to a
        // solid, and that token is the page tone (next test).
        expect(bandValue).toContain('var(--nav-band-active)');
    });

    it('--nav-band-active is an alias of --bg-page in BOTH themes, so the band renders as it did', () => {
        // The band reads `--nav-band-active` rather than `--bg-page` so a
        // host that vendors NavItem can colour the current page's band
        // without repainting its page. For Islestone the token must stay
        // the page tone EXACTLY — an alias, not a
        // copied hex that a later palette change would leave behind. The
        // resolution tests above prove the rendered colour; this pins the
        // spelling that keeps them true when the page tone moves.
        expect(METRO['--nav-band-active']).toBe('var(--bg-page)');
        expect(LIGHT['--nav-band-active']).toBe('var(--bg-page)');
    });

    it('the DEFAULT (idle) band still uses the brand ramp — the swap is active-only', () => {
        // Regression guard in the other direction: the active-only
        // page-bg swap must not bleed into the idle/hover band, which
        // is still meant to be the warm brand gradient.
        render(
            <NavItem
                href="/t/acme/projects"
                icon={Settings}
                label="Projects"
                active={false}
            />,
        );
        const link = screen.getByRole('link', { name: 'Projects' });
        // The BASE band (applied in every state) carries the brand
        // ramp; the idle state does NOT override it with --bg-page.
        const bandValue = extractBeforeBg(link.className, 'base');
        expect(bandValue).toContain('var(--brand-default)');
        expect(bandValue).toContain('var(--brand-emphasis)');
        // The idle row must not carry the active page-bg override.
        expect(link.className).not.toContain(
            'linear-gradient(to_bottom,_var(--nav-band-active)',
        );
    });
});
