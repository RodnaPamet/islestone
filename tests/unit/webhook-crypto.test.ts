/**
 * Webhook crypto — HMAC-SHA256 verification and GitHub-style signatures.
 *
 * Copied from inflect-compliance `tests/integration/webhook.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e. It needs no database, so it is a
 * unit test here. The signature-header extraction cases return with
 * `extractSignature` in sub-phase 5.3.
 */
import {
    computeHmacSha256,
    verifyHmacSha256,
    verifyGitHubSignature,
} from '@/app-layer/integrations/webhook-crypto';

describe('Webhook Crypto', () => {
    const secret = 'test-webhook-secret-12345'; // pragma: allowlist secret — test-only HMAC key
    const payload = '{"action":"completed","check_suite":{"id":123}}';

    // ── HMAC-SHA256 ──

    describe('computeHmacSha256', () => {
        it('computes hex-encoded HMAC', () => {
            const sig = computeHmacSha256(payload, secret, 'hex');
            expect(sig).toMatch(/^[a-f0-9]{64}$/);
        });

        it('computes base64-encoded HMAC', () => {
            const sig = computeHmacSha256(payload, secret, 'base64');
            expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
        });

        it('is deterministic for same input', () => {
            const sig1 = computeHmacSha256(payload, secret);
            const sig2 = computeHmacSha256(payload, secret);
            expect(sig1).toBe(sig2);
        });

        it('differs for different payloads', () => {
            const sig1 = computeHmacSha256('payload-a', secret);
            const sig2 = computeHmacSha256('payload-b', secret);
            expect(sig1).not.toBe(sig2);
        });

        it('differs for different secrets', () => {
            const sig1 = computeHmacSha256(payload, 'secret-a');
            const sig2 = computeHmacSha256(payload, 'secret-b');
            expect(sig1).not.toBe(sig2);
        });
    });

    // ── Verification ──

    describe('verifyHmacSha256', () => {
        it('accepts valid signature', () => {
            const sig = computeHmacSha256(payload, secret, 'hex');
            expect(verifyHmacSha256(payload, sig, secret, 'hex')).toBe(true);
        });

        it('rejects wrong signature', () => {
            expect(verifyHmacSha256(payload, 'deadbeef'.repeat(8), secret, 'hex')).toBe(false);
        });

        it('rejects tampered payload', () => {
            const sig = computeHmacSha256(payload, secret, 'hex');
            expect(verifyHmacSha256(payload + 'x', sig, secret, 'hex')).toBe(false);
        });

        it('rejects wrong secret', () => {
            const sig = computeHmacSha256(payload, secret, 'hex');
            expect(verifyHmacSha256(payload, sig, 'wrong-secret', 'hex')).toBe(false);
        });

        it('rejects empty inputs', () => {
            expect(verifyHmacSha256('', 'sig', secret)).toBe(false);
            expect(verifyHmacSha256(payload, '', secret)).toBe(false);
            expect(verifyHmacSha256(payload, 'sig', '')).toBe(false);
        });

        it('rejects mismatched length signatures', () => {
            expect(verifyHmacSha256(payload, 'short', secret)).toBe(false);
        });
    });

    // ── GitHub Signature ──

    describe('verifyGitHubSignature', () => {
        it('accepts valid sha256= prefixed signature', () => {
            const hmac = computeHmacSha256(payload, secret, 'hex');
            const header = `sha256=${hmac}`;

            expect(verifyGitHubSignature(payload, header, secret)).toBe(true);
        });

        it('rejects signature without sha256= prefix', () => {
            const hmac = computeHmacSha256(payload, secret, 'hex');
            expect(verifyGitHubSignature(payload, hmac, secret)).toBe(false);
        });

        it('rejects invalid signature', () => {
            expect(verifyGitHubSignature(payload, 'sha256=invalid', secret)).toBe(false);
        });

        it('rejects empty header', () => {
            expect(verifyGitHubSignature(payload, '', secret)).toBe(false);
        });
    });
});
