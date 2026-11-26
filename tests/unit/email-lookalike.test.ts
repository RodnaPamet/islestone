/**
 * The look-alike check every address entry point asks (decision 252):
 * `hashForLookup` lower-cases in full Unicode, so a character that lower-cases
 * into ASCII makes an address hash as the one it imitates.
 */
import { hasAsciiLookalike } from '@/lib/email-lookalike';
import { hasAsciiLookalike as intakeHasAsciiLookalike } from '@/lib/intake/email/address';
import { hashForLookup } from '@/lib/security/encryption';

describe('hasAsciiLookalike (decision 252)', () => {
    it('flags the Kelvin sign, which the lookup hash takes for an ASCII "k"', () => {
        const lookalike = 'Kai@example.com';
        expect(hashForLookup(lookalike)).toBe(hashForLookup('kai@example.com'));
        expect(hasAsciiLookalike(lookalike)).toBe(true);
    });

    it('flags any character whose case changes into ASCII, either way', () => {
        // LATIN SMALL LETTER LONG S upper-cases to "S"; CAPITAL I WITH DOT ABOVE lower-cases to "i" and a mark.
        for (const v of ['ſam@example.com', 'İvan@example.com']) {
            expect({ v, flagged: hasAsciiLookalike(v) }).toEqual({ v, flagged: true });
        }
    });

    it('passes ASCII addresses and non-ASCII letters whose case stays outside ASCII', () => {
        for (const ok of ['kai@example.com', 'KAI@EXAMPLE.COM', 'иван@пример.бг', 'josé@exemple.fr', 'Ωmega@example.gr']) {
            expect({ ok, flagged: hasAsciiLookalike(ok) }).toEqual({ ok, flagged: false });
        }
    });

    it('intake reads the same function', () => {
        expect(intakeHasAsciiLookalike).toBe(hasAsciiLookalike);
    });
});
