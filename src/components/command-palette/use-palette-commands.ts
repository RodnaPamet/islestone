'use client';

/**
 * Epic 57 — navigation and action commands for the Command Palette.
 *
 * Rewritten for Islestone from inflect-compliance
 * `src/components/command-palette/use-palette-commands.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 1.7). Kept verbatim:
 * the types, `tenantPath` and `filterPaletteCommands`. Rewritten: the
 * command list, which named the compliance product's routes.
 *
 * The palette hosts two tightly curated command buckets:
 *
 *   - **Navigation**: one entry per shell route, from `NAV_PATHS` in
 *     `@/components/layout/nav-config`, the list the sidebar reads, so users
 *     who know the sidebar learn the palette for free.
 *
 *   - **Actions**: only universally safe ones — `Ask the assistant` (only
 *     while the assistant's launcher is mounted, sub-phase 6.4),
 *     `Toggle theme` and `Sign out`. Destructive or permission-gated
 *     actions are deliberately excluded; running them from the palette
 *     bypasses the confirmation UX their dedicated surfaces provide.
 *
 * All navigation commands are tenant-scoped via `/t/<slug>/...` so the
 * same URL-derived slug that powers entity search powers them too.
 * Outside a tenant route this hook returns an empty list, so the
 * palette on `/login` only shows the keyboard-shortcut discoverability
 * group.
 *
 * Permissions: the palette sits above the workspace's context provider, so
 * the shell registers what the member may reach (`./workspace-access`), and
 * the Settings row is listed only when that says `mayOpenSettings` for the
 * workspace in the URL (owner decision, 2026-11-19). The page keeps its own
 * server-side gate: a client-side filter is a convenience, never a security
 * boundary.
 */

import {
    Bell,
    CalendarClock,
    ClipboardList,
    Folder,
    LayoutList,
    LogOut,
    Moon,
    Settings,
    Sparkles,
    UserCheck,
    type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, type ComponentType, type SVGProps } from 'react';

import { useAssistantOpen } from '@/components/assistant/assistant-open-context';
import { NAV_PATHS } from '@/components/layout/nav-config';
import { useTheme } from '@/components/theme/ThemeProvider';

import { usePaletteWorkspaceAccess } from './workspace-access';
import { signOutToLogin } from '@/lib/auth/client-sign-out';

export type PaletteCommandGroup = 'Navigation' | 'Actions';

/**
 * Either icon family. Nucleo components are plain
 * `(props: SVGProps<SVGSVGElement>) => Element` functions and are NOT
 * assignable to lucide's `ForwardRefExoticComponent`. See the identical
 * widening on `NavItemProps.icon`.
 */
export type PaletteGlyph = LucideIcon | ComponentType<SVGProps<SVGSVGElement>>;

export interface PaletteCommand {
    id: string;
    group: PaletteCommandGroup;
    label: string;
    icon: PaletteGlyph;
    /** Populated for `Navigation` commands. */
    href?: string;
    /** Populated for `Actions`. Closes the palette automatically after invocation. */
    perform?: () => void;
    /**
     * The command's English name, MATCH-ONLY (#5309). The rendered `label`
     * is in the reader's language; this keeps the English word finding the
     * row in any locale. In English it equals the label and adds nothing.
     */
    matchLabel?: string;
    /**
     * MATCH-ONLY vocabulary. Never rendered — `command-palette.tsx` draws
     * `label` and nothing else.
     *
     * This is the channel for words a member TYPES but which must not be
     * the row's name ("notifications" finds the Inbox). Keywords separate the
     * two axes: the label stays the thing a reader understands, the keywords
     * are the things a searcher tries.
     */
    keywords?: readonly string[];
}

function tenantPath(slug: string, path: string): string {
    return `/t/${encodeURIComponent(slug)}${path}`;
}

export function usePaletteCommands(tenantSlug: string | null): PaletteCommand[] {
    const t = useTranslations('commandPalette.commands');
    const { toggle: toggleTheme } = useTheme();
    // `available` is registered by the launcher on mount, not re-derived from
    // the AI_ASSISTANT_ENABLED flag — that flag is server env and a second
    // copy of the gate here could disagree with the one that decides whether
    // the button exists.
    const { available: assistantAvailable, setOpen: setAssistantOpen } = useAssistantOpen();
    const openAssistant = useCallback(() => {
        setAssistantOpen(true);
    }, [setAssistantOpen]);
    // Fail closed: no registered answer for this workspace, no Settings row.
    const mayOpenSettings = usePaletteWorkspaceAccess(tenantSlug)?.mayOpenSettings === true;
    const doSignOut = useCallback(() => {
        void signOutToLogin();
    }, []);

    return useMemo<PaletteCommand[]>(() => {
        if (!tenantSlug) return [];
        const href = (path: string) => tenantPath(tenantSlug, path);
        const commands: PaletteCommand[] = [
            // ─── Navigation ───────────────────────────────────────────
            {
                id: 'nav:my-work',
                group: 'Navigation',
                label: t('goToMyWork'),
                matchLabel: 'My Work',
                icon: UserCheck,
                href: href(NAV_PATHS.myWork),
                keywords: ['assigned', 'home'],
            },
            {
                id: 'nav:inbox',
                group: 'Navigation',
                label: t('goToInbox'),
                matchLabel: 'Inbox',
                icon: Bell,
                href: href(NAV_PATHS.inbox),
                keywords: ['notifications'],
            },
            {
                id: 'nav:work-items',
                group: 'Navigation',
                label: t('goToWorkItems'),
                matchLabel: 'Work items',
                icon: LayoutList,
                href: href(NAV_PATHS.workItems),
                keywords: ['list', 'board', 'issues'],
            },
            {
                id: 'nav:projects',
                group: 'Navigation',
                label: t('goToProjects'),
                matchLabel: 'Projects',
                icon: Folder,
                href: href(NAV_PATHS.projects),
            },
            {
                id: 'nav:cycles',
                group: 'Navigation',
                label: t('goToCycles'),
                matchLabel: 'Cycles',
                icon: CalendarClock,
                href: href(NAV_PATHS.cycles),
                keywords: ['burn-up', 'rollover'],
            },
            {
                id: 'nav:forms',
                group: 'Navigation',
                label: t('goToForms'),
                matchLabel: 'Forms',
                icon: ClipboardList,
                href: href(NAV_PATHS.forms),
                keywords: ['request', 'intake'],
            },
            {
                id: 'nav:views',
                group: 'Navigation',
                label: t('goToViews'),
                matchLabel: 'Views',
                icon: LayoutList,
                href: href(NAV_PATHS.views),
            },
        ];
        if (mayOpenSettings) {
            commands.push({
                id: 'nav:settings',
                group: 'Navigation',
                label: t('goToSettings'),
                matchLabel: 'Settings',
                icon: Settings,
                href: href(NAV_PATHS.settings),
                keywords: ['admin', 'members'],
            });
        }
        // ─── Actions ──────────────────────────────────────────────────
        if (assistantAvailable) {
            commands.push({
                id: 'action:open-assistant',
                group: 'Actions',
                label: t('askAssistant'),
                matchLabel: 'Ask the assistant',
                icon: Sparkles,
                perform: openAssistant,
            });
        }
        commands.push(
            {
                id: 'action:toggle-theme',
                group: 'Actions',
                label: t('toggleTheme'),
                matchLabel: 'Toggle theme',
                icon: Moon,
                perform: toggleTheme,
                keywords: ['dark', 'light'],
            },
            {
                id: 'action:sign-out',
                group: 'Actions',
                label: t('signOut'),
                matchLabel: 'Sign out',
                icon: LogOut,
                perform: doSignOut,
            },
        );
        return commands;
    }, [t, tenantSlug, mayOpenSettings, toggleTheme, doSignOut, assistantAvailable, openAssistant]);
}

/**
 * Case-insensitive substring filter on the command label, its English
 * `matchLabel`, OR any of its match-only `keywords`. cmdk's own filter is disabled at the palette level
 * (`command-palette.tsx` passes `shouldFilter={false}`, because entity search
 * is backend-filtered), so this is not one matcher of two — it is the whole
 * command-matching mechanism, and a word absent from both channels here
 * reaches the palette's empty state.
 */
export function filterPaletteCommands(
    commands: PaletteCommand[],
    query: string,
): PaletteCommand[] {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
        (c) =>
            c.label.toLowerCase().includes(q) ||
            c.matchLabel?.toLowerCase().includes(q) ||
            c.keywords?.some((k) => k.toLowerCase().includes(q)),
    );
}
