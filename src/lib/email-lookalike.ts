/**
 * Look-alike email addresses (owner decision 252).
 *
 * `hashForLookup` folds case in full Unicode before it hashes, and its
 * derivation is a one-way literal (CLAUDE.md, "Keys"): `K` (the Kelvin sign,
 * U+212A) lower-cases to `k`, so `KAI@corp.com` spelt with it hashes as
 * `kai@corp.com` does. Rather than move every stored hash, an address holding
 * such a character is refused wherever an address enters: registration,
 * password sign-in, a Google or Microsoft sign-in, invites, password reset and
 * the verification resend. Found by Hardening H2f's fuzzing; intake refuses
 * to verify such a sender for the same reason (`docs/intake.md`, "Fuzzing").
 *
 * Client-safe: no imports.
 */

/**
 * Whether `value` holds a character outside ASCII that changes case into
 * ASCII (`K`, the Kelvin sign, lower-cases to `k`; `ſ` upper-cases to `S`).
 */
export function hasAsciiLookalike(value: string): boolean {
    for (const ch of value) {
        if (ch.charCodeAt(0) < 0x80) continue;
        if (/[\x00-\x7f]/.test(ch.toLowerCase()) || /[\x00-\x7f]/.test(ch.toUpperCase())) return true;
    }
    return false;
}

/** The sentence a person sees when an address is refused. */
export const LOOKALIKE_EMAIL_MESSAGE =
    'This email address contains a character that imitates another letter. Type the address with ordinary letters.';
