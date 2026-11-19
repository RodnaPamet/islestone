/**
 * The browser-tab icon (`src/app/icon.svg`, Next.js's `icon` file
 * convention) is a placeholder letter mark until Islestone has a logo (owner
 * decision, 2026-11-19; docs/HANDOFF.md row 39): the initials `IS`, white on
 * the brand ramp. An SVG favicon is served on its own and cannot read CSS
 * variables, so it spells the light theme's brand colours; this test holds
 * them equal to `src/styles/tokens.css`, so a palette change moves both.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { REPO_ROOT } from '../helpers/git-files';

const icon = fs.readFileSync(path.join(REPO_ROOT, 'src/app/icon.svg'), 'utf8');
const tokens = fs.readFileSync(path.join(REPO_ROOT, 'src/styles/tokens.css'), 'utf8');

/** A token's value in the light block (`:root, [data-theme="light"]`). */
function lightToken(name: string): string {
    const start = tokens.indexOf('[data-theme="light"] {');
    const block = tokens.slice(start, tokens.indexOf('\n}', start));
    const m = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`));
    if (!m?.[1]) throw new Error(`${name} not found in the light token block`);
    return m[1].toLowerCase();
}

describe('the placeholder app icon', () => {
    it('is an SVG with the initials IS', () => {
        expect(icon.startsWith('<svg')).toBe(true);
        expect(icon).toMatch(/<text[^>]*>IS<\/text>/);
    });

    it('paints the light theme brand ramp and the inverted content colour', () => {
        const stops = [...icon.matchAll(/stop-color="(#[0-9a-fA-F]{6})"/g)].map((m) => (m[1] as string).toLowerCase());
        expect(stops).toEqual([lightToken('--brand-emphasis'), lightToken('--brand-default'), lightToken('--brand-muted')]);
        expect(icon).toContain(`fill="${lightToken('--content-inverted')}"`);
    });

    it('carries no script and no external reference', () => {
        expect(icon).not.toMatch(/<script|href=|url\((?!#)/i);
    });
});
