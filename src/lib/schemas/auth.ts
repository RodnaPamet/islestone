/**
 * Request bodies of the authentication routes.
 *
 * Copied from inflect-compliance `src/lib/schemas/index.ts` (the "Auth"
 * section) at 5528464fc54a8681956f3b9ce23ca9c075f0420e. The parent's
 * 1,386-line module is not ported; its `.openapi()` annotations return with
 * the OpenAPI layer in sub-phase 5.2. `tests/guards/hibp-coverage.test.ts`
 * reads this folder and requires both names below, password-bearing.
 */
import { z } from 'zod';

export const AuthRegisterSchema = z
    .object({
        email: z.string().email(),
        // The length policy (8 to 128) is the route's, so a refusal carries
        // its code; a schema floor here would answer a bare VALIDATION_ERROR.
        password: z.string().min(1),
        name: z.string().min(1),
        // Omitted: an account only, for the invitation in the request's
        // `islestone_invite_token` cookie. Present: a new workspace.
        orgName: z.string().optional(),
    })
    .strip();

// The parent's `action: 'login'` was removed: every login flows through
// NextAuth's Credentials provider. The union is kept as a single-variant
// discriminated union; the variant check still catches other malformed
// bodies.
export const AuthActionSchema = z.discriminatedUnion('action', [
    AuthRegisterSchema.extend({ action: z.literal('register') }),
]);
