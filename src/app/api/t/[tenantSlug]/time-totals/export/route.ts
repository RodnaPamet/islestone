/**
 * The time export (sub-phase 3.4d; owner decision 275, CSV and Excel): the
 * entries behind Time totals' filter as `text/csv` or an `.xlsx` workbook
 * (`time.view`; amounts only for `time.rates`), at most 50,000 rows, every
 * text cell guarded against formulas, audited `TIME_EXPORTED`. A read that
 * decrypts descriptions, so it is also charged to the mutation tier's budget
 * (`rateLimit.everyMethod`).
 *
 *   GET `?format=csv|xlsx&from&to[&projectId][&userId][&billable]`
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { exportTimeEntries } from '@/app-layer/usecases/time-totals';
import { TimeExportQuerySchema } from '@/lib/schemas/billable-rate';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('time.view', async (req: NextRequest, _args, ctx) => {
        const { format, ...filter } = TimeExportQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        const file = await exportTimeEntries(ctx, { filter, format });
        return new Response(new Uint8Array(file.body), {
            status: 200,
            headers: {
                'Content-Type': file.contentType,
                'Content-Disposition': `attachment; filename="${file.filename}"`,
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
            },
        });
    }),
    { rateLimit: { everyMethod: true } },
);
