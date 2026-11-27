/**
 * The workspace sidebar's navigation: what it lists, in what order, behind
 * which gate. Written fresh for Islestone (sub-phase 1.7); the roadmap
 * forbids porting inflect-compliance's compliance list, and ADR 0006 fixes
 * the words (My Work, Inbox, Projects, Views, Settings).
 *
 * `NAV_PATHS` is the one list of the shell's routes. The command palette's
 * navigation rows read it, so the sidebar and the palette cannot disagree
 * about where My Work is. A route added here also goes in
 * `MAIN_PAGES` (`@/lib/nav/page-segregation`) and in `common.sections`
 * (the back affordance's labels); the page-segregation guard holds the first.
 *
 * This module imports no component (the icons are leaf SVG modules), so the
 * palette can share it without a cycle.
 */
import type { Role } from '@prisma/client';
import { useTranslations } from 'next-intl';

import { Bell, CalendarRefresh, Timer2, EnvelopeArrowRight, Folder, GridLayoutRows, InputField, MarketingTarget, UserCheck, Views } from '@inflect/ui/components/ui/icons/nucleo';
import { membershipOpensAdminConsole } from '@/lib/auth/edge-admin-roles';
import type { PermissionSet } from '@/lib/permissions';
import { usePendingIntakeCount } from '@/components/intake/data/intake-data';
import { usePermissions, useTenantContext, useTenantHref } from '@/lib/tenant-context-provider';

import type { NavGlyph } from './nav-item';

/** Every page the shell links to, relative to `/t/<slug>`. */
export const NAV_PATHS = {
    myWork: '/my-work',
    inbox: '/inbox',
    // Sub-phase 3.4b: one sidebar entry, Time, over My time (3.4c adds Timesheets, 3.4d Time totals).
    time: '/time',
    workItems: '/work-items',
    projects: '/projects',
    cycles: '/cycles',
    intake: '/intake',
    forms: '/forms',
    views: '/views',
    // Decision 222: one sidebar entry, Roadmap, over three pages: the Roadmap
    // page (3.2c, the entry's landing page), Goals and Initiatives (3.2b).
    // `ROADMAP_AREA` marks the entry current on every page under it.
    roadmap: '/roadmap',
    goals: '/roadmap/goals',
    initiatives: '/roadmap/initiatives',
    settings: '/settings',
} as const;

/** The Time entry's area: every page under it (3.4b; Timesheets and Time totals join it). */
export const TIME_AREA = '/time';

/** The Roadmap entry's area: every page under it (decision 222). */
export const ROADMAP_AREA = '/roadmap';

export type NavRouteKey = keyof typeof NAV_PATHS;

/**
 * Whether the signed-in member may open Settings: the `admin.view` key, on a
 * membership whose OWN built-in role opens the admin console (a custom role
 * granting `admin.view` to a Member does not). The sidebar's gear, the
 * palette row and the page itself ask the same two questions; the page asks
 * them on the server.
 */
export function mayOpenSettings(perms: PermissionSet, membershipRole: Role | undefined): boolean {
    return perms.admin.view === true && membershipOpensAdminConsole(membershipRole);
}

export interface NavItemDef {
    /** Which route this is; its test id is `nav-<key>`. */
    key: NavRouteKey;
    href: string;
    label: string;
    icon: NavGlyph;
    badge?: string | number;
    /** Accessible description of what `badge` counts (see NavItem). */
    badgeLabel?: string;
    /** If set, the item is shown only when this is strictly `true` (fail-closed). */
    visible?: boolean;
    /** The path prefix the item is current under, when wider than `href` (the Roadmap entry's three pages). */
    activePrefix?: string;
}

export interface NavSectionDef {
    title?: string;
    items: NavItemDef[];
}

/**
 * The sidebar's sections.
 *
 *   (untitled)   My Work, Inbox, Time (3.4b) — the member's own work, notifications and time
 *   Workspace    Work items, Projects, Cycles (2.5a), Roadmap (3.2b), Intake and Forms (2.6a), Views
 *
 * Settings is the footer gear, not a row. Work items (the workspace-wide
 * list and board) and Projects arrived with 2.3; the Inbox unread badge
 * arrives with 2.7.
 */
export function useNavSections(): NavSectionDef[] {
    const tenantHref = useTenantHref();
    const t = useTranslations('nav');
    const perms = usePermissions();
    // Sub-phase 2.6a: Intake for readers of intake, with the count of new
    // requests (owner decision 95); the page asks the key on the server.
    const readsIntake = perms.intake?.view === true;
    const pending = usePendingIntakeCount(readsIntake).data?.total ?? 0;

    const sections: NavSectionDef[] = [
        {
            items: [
                { key: 'myWork', href: tenantHref(NAV_PATHS.myWork), label: t('myWork'), icon: UserCheck },
                { key: 'inbox', href: tenantHref(NAV_PATHS.inbox), label: t('inbox'), icon: Bell },
                // Sub-phase 3.4b (decision 265): the person's own time, for holders of time.track
                // (and, from 3.4c, those who approve weeks), current on every page under /time.
                {
                    key: 'time',
                    href: tenantHref(NAV_PATHS.time),
                    label: t('time'),
                    icon: Timer2,
                    visible: mayOpenTimeOf(perms),
                    activePrefix: tenantHref(TIME_AREA),
                },
            ],
        },
        {
            title: t('workspace'),
            items: [
                // Each workspace row shows to a holder of the key its page asks on the
                // server. Every workspace-wide role holds them; a GUEST holds none until
                // 8.4 (owner decision 204), so its sidebar is My Work and Inbox.
                { key: 'workItems', href: tenantHref(NAV_PATHS.workItems), label: t('workItems'), icon: GridLayoutRows, visible: perms.work_items?.view === true },
                { key: 'projects', href: tenantHref(NAV_PATHS.projects), label: t('projects'), icon: Folder, visible: perms.projects?.view === true },
                // Sub-phase 2.5a (`cycles.view`).
                { key: 'cycles', href: tenantHref(NAV_PATHS.cycles), label: t('cycles'), icon: CalendarRefresh, visible: perms.cycles?.view === true },
                // Decision 222 (`goals.view`): the Roadmap page (3.2c), Goals and Initiatives (3.2b).
                {
                    key: 'roadmap',
                    href: tenantHref(NAV_PATHS.roadmap),
                    label: t('roadmap'),
                    icon: MarketingTarget,
                    visible: perms.goals?.view === true,
                    activePrefix: tenantHref(ROADMAP_AREA),
                },
                {
                    key: 'intake',
                    href: tenantHref(NAV_PATHS.intake),
                    label: t('intake'),
                    icon: EnvelopeArrowRight,
                    visible: readsIntake,
                    ...(pending > 0 ? { badge: pending, badgeLabel: t('intakeBadge', { count: pending }) } : {}),
                },
                // Every member who sees projects may send a request through an open form.
                { key: 'forms', href: tenantHref(NAV_PATHS.forms), label: t('forms'), icon: InputField, visible: perms.projects?.view === true },
                { key: 'views', href: tenantHref(NAV_PATHS.views), label: t('views'), icon: Views, visible: perms.views?.view === true },
            ],
        },
    ];

    // DEFENSE-IN-DEPTH: the server resolves permissions per request, and
    // each page asserts its own; this filter keeps a gated row off the
    // sidebar. Fail-closed: an item with `visible` set shows only when it is
    // strictly `true`, so a permission bag missing a key hides the row.
    return sections
        .map((section) => ({
            ...section,
            items: section.items.filter((item) => item.visible === undefined || item.visible === true),
        }))
        .filter((section) => section.items.length > 0);
}

/** Whether the current member may open Settings (see `mayOpenSettings`). */
export function useMayOpenSettings(): boolean {
    const perms = usePermissions();
    const { membershipRole } = useTenantContext();
    return mayOpenSettings(perms, membershipRole);
}

/** The Time entry's rule (3.4b): a holder of `time.track` or `time.approve`. The page asks the same on the server. */
export function mayOpenTimeOf(perms: PermissionSet): boolean {
    return perms.time?.track === true || perms.time?.approve === true;
}

/** Whether the current member may open the Time entry (`mayOpenTimeOf`). */
export function useMayOpenTime(): boolean {
    return mayOpenTimeOf(usePermissions());
}
