import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';

import { CSP_NONCE_HEADER } from '@/lib/security/csp';
// The theme constants come from the SERVER-SAFE module, never from
// ThemeProvider ('use client'), whose exports resolve to client-reference
// proxies (not their string values) on the server. See
// src/lib/theme-constants.ts.
//
// THEME_INIT_SCRIPT is the anti-FOUC script, the SECOND line of defence behind
// the SSR cookie. A member who has CHOSEN a theme has the cookie, so their
// `<html>` is already correct in the first SSR byte. The script covers
// everyone else: a choice kept only in localStorage, and a visitor who never
// chose, whose theme follows the operating system. It writes nothing.
import { DEFAULT_THEME, THEME_COOKIE, THEME_INIT_SCRIPT } from '@/lib/theme-constants';
import type { Theme } from '@/lib/theme-constants';

import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
    title: 'Islestone',
    description: 'AI-enabled project management.',
};

/**
 * Explicit viewport metadata: Next.js emits no default viewport meta, so the
 * root declares it once for every page. `maximumScale: 5` keeps pinch-zoom
 * (an accessibility requirement; never 1). `tests/guards/mobile-readiness`
 * holds it.
 */
export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
    viewportFit: 'cover',
};

/**
 * The root layout. Merged from Islestone's 1.1 to 1.5 layout and
 * inflect-compliance `src/app/layout.tsx` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 1.7): the locale and
 * messages, the server-rendered theme, the anti-FOUC script and the client
 * `Providers` (the command palette, shortcuts, theme, toasts).
 */
export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
    const locale = await getLocale();
    const messages = await getMessages();
    // The per-request CSP nonce (src/middleware.ts). Reading the request
    // headers renders every page dynamically, which a nonce requires: a page
    // prerendered at build time would carry no nonce, and `strict-dynamic`
    // would block its scripts.
    const nonce = (await headers()).get(CSP_NONCE_HEADER) ?? undefined;

    // Flash-proof theme: render `data-theme` from the persisted cookie so the
    // FIRST SSR byte is already the member's theme. The cookie exists only
    // once the member has CHOSEN a theme; without it this renders the light
    // baseline, and the blocking script below switches to the operating
    // system's theme before the browser paints, so there is no flash.
    const cookieTheme = (await cookies()).get(THEME_COOKIE)?.value;
    const initialTheme: Theme = cookieTheme === 'light' || cookieTheme === 'dark' ? cookieTheme : DEFAULT_THEME;

    return (
        <html lang={locale} data-theme={initialTheme} suppressHydrationWarning>
            <head>
                {/* Anti-FOUC: apply the stored or the OS theme before the
                    browser paints. Carries the CSP nonce. */}
                <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
                {/*
                    The bundler's chunk loader injects code-split chunks with
                    `document.createElement('script')`, which do not inherit the
                    nonce: it sets `script.nonce` only when `__webpack_nonce__`
                    is defined before the first chunk loads. Copied from
                    inflect-compliance's root layout (sub-phase 1.5). The
                    content is the nonce alone, no user input.
                    `suppressHydrationWarning` because browsers hide a `nonce`
                    attribute from the DOM after CSP processing, so React would
                    otherwise report a mismatch on every page.
                */}
                {nonce && (
                    <script
                        nonce={nonce}
                        suppressHydrationWarning
                        dangerouslySetInnerHTML={{
                            __html: `window.__webpack_nonce__=${JSON.stringify(nonce)};globalThis.__webpack_nonce__=${JSON.stringify(nonce)};`,
                        }}
                    />
                )}
            </head>
            <body className="min-h-dvh antialiased" suppressHydrationWarning>
                {/* NextIntlClientProvider MUST wrap <Providers>, not sit inside
                    it: <Providers> renders app-wide client chrome (the command
                    palette, the shortcut-help modal, toasts) that calls
                    useTranslations(). Inside Providers, those components would
                    render with no intl context and throw during SSR. */}
                <NextIntlClientProvider messages={messages} locale={locale}>
                    <Providers>{children}</Providers>
                </NextIntlClientProvider>
            </body>
        </html>
    );
}
