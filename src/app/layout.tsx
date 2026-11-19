import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';

import { CSP_NONCE_HEADER } from '@/lib/security/csp';

import './globals.css';

export const metadata: Metadata = {
    title: 'Islestone',
    description: 'AI-enabled project management.',
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
    // The per-request CSP nonce (src/middleware.ts). Reading the request
    // headers renders every page dynamically, which a nonce requires: a page
    // prerendered at build time would carry no nonce, and `strict-dynamic`
    // would block its scripts.
    const nonce = (await headers()).get(CSP_NONCE_HEADER) ?? undefined;

    return (
        <html lang="en">
            <head>
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
            <body className="min-h-dvh antialiased">
                {/* Rendered from a Server Component, the provider passes the request config's messages on to client components. */}
                <NextIntlClientProvider>{children}</NextIntlClientProvider>
            </body>
        </html>
    );
}
