/**
 * Request-body schemas shared by many routes.
 *
 * Copied from inflect-compliance `src/lib/schemas/index.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (`EmptyBodySchema`), without its
 * `.openapi()` annotation (sub-phase 5.2).
 */
import { z } from 'zod';

/** An empty request body, for mutations whose meaning is all in the URL. */
export const EmptyBodySchema = z.object({}).strip();
