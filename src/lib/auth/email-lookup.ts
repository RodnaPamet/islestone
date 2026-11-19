/**
 * The form an email address is stored and looked up in: trimmed and
 * lower-cased. Edge-safe and client-safe (no imports).
 *
 * inflect-compliance stores `User.email` encrypted and looks users up by a
 * keyed hash of this same normal form (`hashForLookup` in
 * `src/lib/security/encryption.ts`, which lower-cases and trims before it
 * hashes). Islestone's `User.email` is plaintext and unique until sub-phase
 * 1.5 adds `emailHash` and the PII extension (prisma/schema/tenancy.prisma),
 * so sub-phase 1.4 stores and matches the normal form itself. Every copied
 * `where: { emailHash: hashForLookup(x) }` became
 * `where: { email: lookupEmail(x) }`, and every create of a `User` stores
 * `lookupEmail(x)`, so two spellings of one address are one user.
 */
export function lookupEmail(value: string): string {
    return value.toLowerCase().trim();
}
