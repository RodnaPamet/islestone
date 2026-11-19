/**
 * The form an email address is stored in: trimmed and lower-cased. Edge-safe
 * and client-safe (no imports).
 *
 * Since sub-phase 1.5, `User.email` is encrypted at rest and a user is looked
 * up by `emailHash`, a keyed hash of this same normal form (`hashForLookup`
 * in `src/lib/security/encryption.ts` lower-cases and trims before it hashes),
 * as in inflect-compliance: `where: { emailHash: hashForLookup(x) }`. Every
 * create of a `User` still stores `lookupEmail(x)`, so the decrypted address
 * a user sees is the one their lookups hash.
 */
export function lookupEmail(value: string): string {
    return value.toLowerCase().trim();
}
