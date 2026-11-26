/**
 * A requester's name as it is stored (sub-phase 2.6b's public forms, 2.6c's
 * inbound email; Hardening H2f): sanitised as plain text, every control and
 * bidirectional embedding, override or isolate character turned into a space
 * (as a request's title is, `cleanTitle`), whitespace collapsed, at most
 * `INTAKE_LIMITS.requesterName` characters, or null when nothing is left.
 *
 * Found by H2f's fuzzing: the name kept a right-to-left override (which turns
 * the text after it around on the Intake page) and NUL; and an emailed
 * `From` display name was sanitised whole before it was cut to length, so a
 * multi-megabyte name of nested tags held the worker in the sanitiser for
 * minutes. The input is bounded first.
 *
 * Server-only (the sanitiser). Written fresh for Islestone.
 */
import { INTAKE_LIMITS } from '@/lib/intake/form-definition';
import { sanitizePlainText } from '@/lib/security/sanitize';

/** How much of a raw name is read: ten times what is kept. */
const NAME_SCAN = INTAKE_LIMITS.requesterName * 10;

const CONTROL_AND_BIDI = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

export function cleanRequesterName(raw: string | null | undefined): string | null {
    if (raw === null || raw === undefined) return null;
    const name = sanitizePlainText(raw.slice(0, NAME_SCAN)).replace(CONTROL_AND_BIDI, ' ').replace(/\s+/g, ' ').trim().slice(0, INTAKE_LIMITS.requesterName).trim();
    return name.length > 0 ? name : null;
}
