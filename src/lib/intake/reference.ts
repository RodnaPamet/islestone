/**
 * A request's short reference (sub-phase 2.6; owner decision 89): the last
 * eight characters of its id, upper-cased. Shown on the confirmation screen
 * and named in a requester's emails, so they can quote it; it carries nothing
 * about the workspace. Client-safe.
 */
export function intakeReference(requestId: string): string {
    return requestId.slice(-8).toUpperCase();
}
