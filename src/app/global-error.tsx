'use client';

import styles from './global-error.module.css';

/**
 * Root-level global error boundary for the App Router. Required by the App
 * Router to handle errors in the root layout itself; it replaces the root
 * layout, so it renders its own <html> and <body>, outside every provider.
 * That is why its copy is static English rather than catalogue keys: the
 * intl provider is part of what failed.
 *
 * CSP NOTE: all styles are in global-error.module.css (a CSS module bundled
 * with this component). No inline style attributes are used, so style-src
 * does not need 'unsafe-inline'.
 *
 * Copied from inflect-compliance `src/app/global-error.tsx` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 1.7). Cut: the browser
 * Sentry call and its `console.error` fallback (Islestone reports errors on
 * the server, sub-phase 1.6), and "Our team has been notified", which only a
 * browser report would make true.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <html lang="en">
            <body className={styles.body}>
                <div className={styles.container}>
                    <div className={styles.card}>
                        <div className={styles.iconWrap}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                        </div>
                        <h2 className={styles.heading}>Something went wrong</h2>
                        <p className={styles.message}>
                            An unexpected error occurred.
                            {error.digest && <span className={styles.digest}>Error ID: {error.digest}</span>}
                        </p>
                        <button type="button" onClick={() => reset()} className={styles.retryBtn}>
                            Try again
                        </button>
                    </div>
                </div>
            </body>
        </html>
    );
}
