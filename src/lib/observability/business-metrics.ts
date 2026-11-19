/**
 * Business metrics — SUB-PHASE 1.4 STUB at the final module path.
 *
 * Sub-phase 1.6 ports inflect-compliance's business-metrics module and
 * replaces this file. Until then each counter is a no-op with its real
 * signature.
 */
export type SignupSource = 'oauth_google' | 'oauth_microsoft' | 'saml' | 'credentials' | 'invite';
export type MfaMethod = 'totp' | 'webauthn';

export function recordTenantCreated(_attrs: { signupSource: string }): void {}
export function recordUserSignup(_attrs: { signupSource: SignupSource }): void {}
export function recordInviteSent(): void {}
export function recordInviteRedeemed(_attrs: { timeToAcceptMs: number }): void {}
export function recordMfaEnrolled(_attrs: { method: MfaMethod }): void {}
