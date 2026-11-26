/**
 * Request schemas for calendar sync (roadmap 3.3b; ADR 0011). Written fresh
 * for Islestone.
 */
import type { CalendarProvider } from '@prisma/client';
import { z } from 'zod';

import { ValidationError } from '@/lib/errors/types';

export const SetCalendarSyncSettingsSchema = z.object({ syncEnabled: z.boolean() }).strict();
export type SetCalendarSyncSettingsInput = z.infer<typeof SetCalendarSyncSettingsSchema>;

const PROVIDER_PARAM = z.enum(['google', 'microsoft']);

/** `?provider=google|microsoft` as the provider enum; anything else is a 400. */
export function providerParam(raw: string | null): CalendarProvider {
    const parsed = PROVIDER_PARAM.safeParse(raw);
    if (!parsed.success) throw new ValidationError('provider must be google or microsoft.', { reason: 'INVALID_PROVIDER' });
    return parsed.data === 'google' ? 'GOOGLE' : 'MICROSOFT';
}
