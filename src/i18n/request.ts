import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

import { LOCALE_COOKIE, resolveLocale } from '@/lib/locale-constants';

/**
 * next-intl request config (no i18n routing — the locale lives in a cookie,
 * not the URL). Runs once per request on the server; `getLocale()` /
 * `getMessages()` in the root layout delegate here, so resolving the locale
 * from the `LOCALE_COOKIE` cookie is enough to render the whole app in the
 * chosen language on the first SSR byte.
 *
 * Copied from inflect-compliance `src/i18n.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 1.7), at the plugin's
 * default path. Islestone ships one catalogue, `messages/en.json`, built key
 * by key (docs/porting/maps/1.2.md section 6.6, 1.7.md section G); a second
 * locale is a catalogue file and an entry in `SUPPORTED_LOCALES`.
 *
 * Unknown / absent cookie → `DEFAULT_LOCALE` ('en') via `resolveLocale`, so a
 * tampered cookie can never point the dynamic `import()` at a missing file.
 */
export default getRequestConfig(async () => {
    const cookieStore = await cookies();
    const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);

    return {
        locale,
        messages: (await import(`../../messages/${locale}.json`)).default,
    };
});
