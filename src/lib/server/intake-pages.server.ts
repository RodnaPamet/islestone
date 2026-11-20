/**
 * What the intake pages read on the server (sub-phase 2.6a): the request
 * context (`getTenantCtx`, the same gates the API asks), the view
 * configuration the accept dialog's pickers read, and the writes the pages
 * offer (`intakeAffordances`, the predicates the usecases assert). A viewer
 * without `intake.view`, or a project or form they cannot see, is a 404.
 *
 * Written fresh for Islestone.
 */
import { notFound } from 'next/navigation';

import { getTenantCtx } from '@/app-layer/context';
import { intakeAffordances, mayReadIntake } from '@/app-layer/policies/intake.policies';
import { getOpenIntakeForm, listOpenIntakeForms } from '@/app-layer/usecases/intake-form';
import { getWorkItemViewConfig } from '@/app-layer/usecases/work-item-views';
import { isAppError } from '@/lib/errors/types';
import { isInboundEmailOpen } from '@/lib/intake/email/switch';
import { isPublicIntakeOpen } from '@/lib/intake/public-switch';
import type { IntakeAffordances, OpenIntakeForm } from '@/lib/intake/types';
import { settingsPageAccess } from '@/lib/server/settings-pages.server';
import type { WorkItemViewConfig } from '@/lib/work-items/types';

async function or404<T>(read: () => Promise<T>): Promise<T> {
    try {
        return await read();
    } catch (err) {
        if (isAppError(err) && (err.status === 404 || err.status === 403)) notFound();
        throw err;
    }
}

export async function intakePageContext(
    tenantSlug: string,
    opts: { projectKeyPrefix?: string } = {},
): Promise<{ config: WorkItemViewConfig; affordances: IntakeAffordances; project: WorkItemViewConfig['projects'][number] | null }> {
    return or404(async () => {
        const ctx = await getTenantCtx({ tenantSlug });
        if (!mayReadIntake(ctx)) notFound();
        const config = await getWorkItemViewConfig(ctx);
        const project = opts.projectKeyPrefix ? (config.projects.find((p) => p.keyPrefix === opts.projectKeyPrefix) ?? null) : null;
        if (opts.projectKeyPrefix && !project) notFound();
        return { config, affordances: intakeAffordances(ctx), project };
    });
}

export async function formsPageContext(tenantSlug: string): Promise<{ forms: OpenIntakeForm[] }> {
    return or404(async () => {
        const ctx = await getTenantCtx({ tenantSlug });
        return { forms: await listOpenIntakeForms(ctx) };
    });
}

export async function formPageContext(tenantSlug: string, formId: string): Promise<{ form: OpenIntakeForm }> {
    return or404(async () => {
        const ctx = await getTenantCtx({ tenantSlug });
        return { form: await getOpenIntakeForm(ctx, formId) };
    });
}

/**
 * Settings → Intake: the Settings page's own gate (`mayOpenSettings`), then
 * the intake writes it offers, and whether public forms are open on this
 * deployment (2.6b), which decides whether a form may be made public.
 */
export async function intakeSettingsAccess(tenantSlug: string): Promise<{ affordances: IntakeAffordances; publicForms: boolean; inboundEmail: boolean }> {
    await settingsPageAccess(tenantSlug);
    return or404(async () => ({
        affordances: intakeAffordances(await getTenantCtx({ tenantSlug })),
        publicForms: isPublicIntakeOpen(),
        // Whether a project's email address may be turned on (2.6c, `INTAKE_EMAIL`).
        inboundEmail: isInboundEmailOpen(),
    }));
}
