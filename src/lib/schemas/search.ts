/**
 * The workspace search's query parameters (sub-phase 2.7b, docs/search.md).
 *
 * `q` is trimmed and cut to `MAX_QUERY_LENGTH` by the usecase; a parameter
 * far past that is refused rather than read. `limit` is the hits per type,
 * bounded by `MAX_PER_TYPE_LIMIT`: a larger page is a 400, not a silent cap.
 *
 * Written fresh for Islestone.
 */
import { z } from 'zod';

import { MAX_PER_TYPE_LIMIT } from '@/lib/search/types';

export const SearchQuerySchema = z.object({
    q: z.string().max(1000).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PER_TYPE_LIMIT).optional(),
});
