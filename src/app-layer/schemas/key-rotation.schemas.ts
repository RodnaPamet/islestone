/**
 * Zod schemas for the key-rotation routes (sub-phase 1.5b).
 *
 * The two POSTs take no body: what they rotate is the caller's own workspace,
 * named by the URL. The two GETs take the BullMQ job id the POST returned.
 */
import { z } from 'zod';

/**
 * `?jobId=` on the status routes. BullMQ ids are short (an integer, or a
 * custom id `enqueue` validated); the cap only stops an absurd value reaching
 * Redis.
 */
export const RotationJobStatusQuery = z.object({
    jobId: z.string({ error: 'jobId required' }).trim().min(1, 'jobId required').max(200, 'jobId is too long'),
});
export type RotationJobStatusQueryInput = z.infer<typeof RotationJobStatusQuery>;
