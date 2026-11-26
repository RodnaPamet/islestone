'use client';

/**
 * Leaving Islestone for a calendar provider's page (roadmap 3.3b): a top-level
 * navigation to the URL the server answered, so the CSP is unchanged (no
 * script, frame or fetch reaches a provider from the browser). Its own module
 * so a rendered test can observe it.
 */
export function leaveFor(url: string): void {
    window.location.assign(url);
}
