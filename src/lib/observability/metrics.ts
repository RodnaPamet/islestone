/**
 * Metrics — SUB-PHASE 1.4 STUB at the final module path.
 *
 * Sub-phase 1.6 ports inflect-compliance's OpenTelemetry metrics module and
 * replaces this file. Until then each counter 1.4's code calls is a no-op
 * with its real signature, so the call sites are already wired.
 */

/** Session-policy resolution outcome (session-tracker). No-op until 1.6. */
export function recordSessionPolicyResolution(_attrs: { outcome: 'ok' | 'failed' }): void {}

/** Verification-email delivery outcome (email-verification). No-op until 1.6. */
export function recordVerificationEmailDelivery(_attrs: {
    outcome: 'sent' | 'failed';
    flow: 'register' | 'resend';
}): void {}
