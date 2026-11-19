/**
 * The theme renders right on the first byte, and nothing stores a theme the
 * member did not choose (sub-phase 1.7).
 *
 *   - The constants live in a SERVER-SAFE module: the root layout (a server
 *     component) reads them, and a value imported from a `'use client'`
 *     module is a client-reference proxy on the server, which silently broke
 *     the cookie read and the inline script in inflect-compliance.
 *   - The layout renders `<html data-theme>` from the theme cookie, light by
 *     default, and inlines the pre-paint script in `<head>` with the CSP
 *     nonce. The script writes nothing and does not read the OS colour
 *     scheme (an owner decision, docs/HANDOFF.md).
 *
 * Written for Islestone from inflect-compliance's
 * `tests/guards/theme-flash-init.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e. The script's behaviour is run, not
 * read, in `tests/rendered/theme-storage-on-choice.test.tsx`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { DEFAULT_THEME, THEME_COOKIE, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from '@/lib/theme-constants';

import { REPO_ROOT } from '../helpers/git-files';
import { codeOf } from '../helpers/source-blocks';

const read = (rel: string) => codeOf(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));

describe('theme anti-FOUC', () => {
    const layout = read('src/app/layout.tsx');
    const constants = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/theme-constants.ts'), 'utf8');

    it('the constants are server-safe and carry the islestone names', () => {
        expect(constants).not.toMatch(/^\s*['"]use client['"]/m);
        expect(THEME_STORAGE_KEY).toBe('islestone:theme');
        expect(THEME_COOKIE).toBe('islestone_theme');
        expect(DEFAULT_THEME).toBe('light');
    });

    it('the layout imports them from the server-safe module, not the client provider', () => {
        expect(layout).toMatch(/import\s*\{[^}]*\bTHEME_COOKIE\b[^}]*\}\s*from\s*['"]@\/lib\/theme-constants['"]/);
        expect(layout).toMatch(/import\s*\{[^}]*\bTHEME_INIT_SCRIPT\b[^}]*\}\s*from\s*['"]@\/lib\/theme-constants['"]/);
        expect(layout).not.toMatch(/from\s*['"]@\/components\/theme\/ThemeProvider['"]/);
    });

    it('renders <html data-theme> from the theme cookie, with the light default', () => {
        expect(layout).toMatch(/<html lang=\{locale\} data-theme=\{initialTheme\}/);
        expect(layout).toMatch(/cookies\(\)\)\.get\(THEME_COOKIE\)/);
        expect(layout).toMatch(/:\s*DEFAULT_THEME;/);
    });

    it('inlines the pre-paint script in <head>, with the nonce, before the body', () => {
        const head = layout.indexOf('<head>');
        const script = layout.indexOf('__html: THEME_INIT_SCRIPT');
        const body = layout.indexOf('<body');
        expect(head).toBeGreaterThanOrEqual(0);
        expect(script).toBeGreaterThan(head);
        expect(script).toBeLessThan(body);
        expect(layout).toMatch(/<script nonce=\{nonce\} suppressHydrationWarning dangerouslySetInnerHTML=\{\{ __html: THEME_INIT_SCRIPT \}\} \/>/);
    });

    it('the script reads the same names, writes nothing and ignores the OS colour scheme', () => {
        expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
        expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(THEME_COOKIE));
        expect(THEME_INIT_SCRIPT).not.toMatch(/document\.cookie\s*=(?!=)/);
        expect(THEME_INIT_SCRIPT).not.toMatch(/localStorage\.setItem/);
        expect(THEME_INIT_SCRIPT).not.toMatch(/prefers-color-scheme|matchMedia/);
    });
});
