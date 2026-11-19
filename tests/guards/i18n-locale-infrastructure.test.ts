/**
 * The locale plumbing (sub-phase 1.7). Islestone ships one catalogue, but the
 * seam for a second is the parent's:
 *
 *   - the next-intl request config (`src/i18n/request.ts`, the plugin's
 *     default path) resolves the locale from the `LOCALE_COOKIE` cookie
 *     through `resolveLocale`, so a tampered cookie cannot point the dynamic
 *     import at a missing file;
 *   - every supported locale has its catalogue, and the shipped set is
 *     English only (roadmap 1.7; a second locale is an owner decision);
 *   - the cookie is named through the UI-storage seam (`islestone_locale`);
 *   - the switcher's short labels are uppercase, because the toggle
 *     capitalises only a word's first letter.
 *
 * Written for Islestone from inflect-compliance's
 * `tests/guardrails/i18n-locale-infrastructure.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    DEFAULT_LOCALE,
    LOCALE_COOKIE,
    LOCALE_SHORT_LABELS,
    SUPPORTED_LOCALES,
    resolveLocale,
} from '@/lib/locale-constants';

import { REPO_ROOT } from '../helpers/git-files';
import { codeOf } from '../helpers/source-blocks';

describe('locale infrastructure', () => {
    it('the request config reads the locale cookie through resolveLocale', () => {
        const config = codeOf(fs.readFileSync(path.join(REPO_ROOT, 'src/i18n/request.ts'), 'utf8'));
        expect(config).toMatch(/resolveLocale\(\s*cookieStore\.get\(\s*LOCALE_COOKIE\s*\)\?\.value\s*\)/);
        expect(config).toMatch(/import\(`\.\.\/\.\.\/messages\/\$\{locale\}\.json`\)/);
    });

    it('ships English only, and every supported locale has its catalogue', () => {
        expect([...SUPPORTED_LOCALES]).toEqual(['en']);
        expect(DEFAULT_LOCALE).toBe('en');
        for (const locale of SUPPORTED_LOCALES) {
            expect(fs.existsSync(path.join(REPO_ROOT, 'messages', `${locale}.json`))).toBe(true);
        }
    });

    it('a tampered or absent cookie resolves to the default', () => {
        expect(resolveLocale('../../etc/passwd')).toBe('en');
        expect(resolveLocale(undefined)).toBe('en');
        expect(resolveLocale('en')).toBe('en');
    });

    it('names the cookie through the UI-storage seam', () => {
        expect(LOCALE_COOKIE).toBe('islestone_locale');
    });

    it('authors the short labels in uppercase', () => {
        for (const label of Object.values(LOCALE_SHORT_LABELS)) expect(label).toBe(label.toUpperCase());
    });
});
