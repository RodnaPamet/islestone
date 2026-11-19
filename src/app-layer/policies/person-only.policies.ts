/**
 * Acts that only the signed-in person may perform on their own identity.
 *
 * A tenant API key (sub-phase 5.2) builds a context whose `userId` is the
 * person who created the key, and an agent run (Phase 6) carries the
 * requester's `userId` beside its agent. Both are right for reading and writing tenant data under that
 * person's authority. They are wrong for acts that change the person
 * themselves or speak in their name: their second factor, their sessions, and
 * their acknowledgement of a policy. Those take the person, signed in.
 */
import { forbidden } from '@/lib/errors/types';
import type { RequestContext } from '../types';

export const NOT_A_PERSON = 'NOT_A_PERSON' as const;

/**
 * Refuse an API key acting on `what`. Phase 6 adds the agent term
 * (`|| ctx.agentId`) when `RequestContext` gains the field.
 */
export function assertActingAsPerson(ctx: RequestContext, what: string): void {
    if (ctx.apiKeyId) {
        throw forbidden(`${what} is done by the signed-in person, not by an API key or an agent.`, {
            reason: NOT_A_PERSON,
        });
    }
}
