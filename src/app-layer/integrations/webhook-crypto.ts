/**
 * Integration Webhook — Signature Verification
 *
 * Generic HMAC-SHA256 verification for webhook payloads.
 * Each provider stores a webhook secret in their IntegrationConnection.
 * The secret is used to compute and verify signatures.
 *
 * Supports:
 *   - HMAC-SHA256 with hex or base64 encoding
 *   - Timing-safe comparison to prevent timing attacks
 *
 * The provider signature-header table and `extractSignature` are not here:
 * sub-phase 5.3 brings them back with the inbound webhook processor.
 *
 * @module integrations/webhook-crypto
 */
import crypto from 'crypto';

/**
 * Compute HMAC-SHA256 signature of a payload.
 */
export function computeHmacSha256(
    payload: string,
    secret: string,
    encoding: 'hex' | 'base64' = 'hex'
): string {
    return crypto
        .createHmac('sha256', secret)
        .update(payload, 'utf8')
        .digest(encoding);
}

/**
 * Verify an HMAC-SHA256 signature with timing-safe comparison.
 *
 * @param payload   - The raw request body string
 * @param signature - The signature from the webhook header
 * @param secret    - The shared webhook secret
 * @param encoding  - How the signature is encoded ('hex' or 'base64')
 * @returns true if signature is valid
 */
export function verifyHmacSha256(
    payload: string,
    signature: string,
    secret: string,
    encoding: 'hex' | 'base64' = 'hex'
): boolean {
    if (!payload || !signature || !secret) return false;

    const expected = computeHmacSha256(payload, secret, encoding);

    // Signatures must be same length for timingSafeEqual
    const sigBuf = Buffer.from(signature, encoding === 'hex' ? 'hex' : 'base64');
    const expBuf = Buffer.from(expected, encoding === 'hex' ? 'hex' : 'base64');

    if (sigBuf.length !== expBuf.length) return false;

    try {
        return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch {
        return false;
    }
}

/**
 * GitHub-style signature verification.
 * GitHub sends: `sha256=<hex>` in X-Hub-Signature-256 header.
 */
export function verifyGitHubSignature(
    payload: string,
    signatureHeader: string,
    secret: string
): boolean {
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
    const signature = signatureHeader.slice('sha256='.length);
    return verifyHmacSha256(payload, signature, secret, 'hex');
}
