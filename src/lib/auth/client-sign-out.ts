'use client';

/**
 * Sign out from the browser and land on `/login`: the application shell's
 * one way out (the sidebar footer, the account menu and the command
 * palette's "Sign out"). It is a seam file (`NEXT_AUTH_SEAM` in
 * `eslint.config.mjs`, ADR 0004 A3), so the shell's components do not load
 * `next-auth/react` themselves.
 */
import { signOut } from 'next-auth/react';

export async function signOutToLogin(): Promise<void> {
    await signOut({ callbackUrl: '/login' });
}
