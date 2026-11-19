import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
    title: 'Islestone',
    description: 'AI-enabled project management.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
    return (
        <html lang="en">
            <body className="min-h-dvh antialiased">
                {/* Rendered from a Server Component, the provider passes the request config's messages on to client components. */}
                <NextIntlClientProvider>{children}</NextIntlClientProvider>
            </body>
        </html>
    );
}
