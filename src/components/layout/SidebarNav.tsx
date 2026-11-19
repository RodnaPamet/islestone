'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTenantContext, useTenantHref } from '@/lib/tenant-context-provider';
import { Tooltip } from '@inflect/ui/components/ui/tooltip';
import { useCommandPalette } from '@/components/command-palette/command-palette-provider';
import { Gear, Menu3, UserArrowRight } from '@inflect/ui/components/ui/icons/nucleo';
import { cn } from '@inflect/ui/lib/cn';
import { NAV_PATHS, useMayOpenSettings, useNavSections } from './nav-config';
import { NavItem } from './nav-item';
import { NavSection } from './nav-section';
import { useSidebarCollapsed } from './sidebar-collapse-context';

/**
 * The workspace sidebar: brand and collapse control, the navigation from
 * `./nav-config` (My Work, Inbox, Projects, Views), the command-palette
 * opener, and the member's footer (name, workspace, role, Settings, sign
 * out).
 *
 * Rewritten for Islestone from inflect-compliance
 * `src/components/layout/SidebarNav.tsx` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 1.7): the component is
 * kept, the compliance navigation register is not (it moved, rewritten, to
 * `nav-config.ts`), nor are the calendar badge, the agent-inventory gate, the
 * module flag and the onboarding-tour button.
 */

// ─── Sidebar content (shared between desktop sidebar and mobile drawer) ───

interface SidebarContentProps {
    user: { name?: string | null };
    onLogout: () => void;
    onNavClick?: () => void;
    /** Desktop only — when provided, renders the collapse/expand toggle. */
    onToggleCollapse?: () => void;
}

export function SidebarContent({ user, onLogout, onNavClick, onToggleCollapse }: SidebarContentProps) {
    const pathname = usePathname();
    const tc = useTranslations('common');
    const tn = useTranslations('nav');
    // The role under the user's name, by its label as the workspace switcher
    // shows it — the stored value only where no label exists (#5309).
    const tRoles = useTranslations('roles');
    const tenant = useTenantContext();
    const tenantHref = useTenantHref();
    const mayOpenSettings = useMayOpenSettings();
    const sections = useNavSections();
    const { open: openPalette } = useCommandPalette();
    // Icon-rail mode (desktop). The mobile drawer's provider always reports
    // false, so this whole branch is desktop-only in practice.
    const collapsed = useSidebarCollapsed();

    return (
        <div className="flex flex-col h-full">
            {/* Brand / collapse. On desktop the brand slot IS the collapse
                control — a hamburger that toggles the icon rail (replacing the
                old bottom-of-sidebar collapse button). The mobile drawer has no
                `onToggleCollapse`, so it keeps the static brand mark. */}
            <div className="p-4 border-b border-border-subtle">
                {onToggleCollapse ? (
                    <button
                        type="button"
                        onClick={onToggleCollapse}
                        // WCAG 2.1 SP 2.5.3 (Label in Name). EXPANDED, this
                        // button's visible text is the app name, so a label of
                        // "Collapse sidebar" named something the reader cannot
                        // see — "click Islestone" reached nothing. The label
                        // now contains it. COLLAPSED there is no visible text
                        // at all (icon only), so the plain form is correct
                        // there and 2.5.3 does not apply.
                        aria-label={
                            collapsed
                                ? tn('expandSidebar')
                                : tn('collapseSidebarNamed', { app: tc('appName') })
                        }
                        aria-pressed={collapsed}
                        data-testid="sidebar-collapse-toggle"
                        className={cn(
                            'flex w-full items-center rounded-lg text-content-muted transition-colors hover:text-content-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                            collapsed ? 'justify-center' : 'gap-tight',
                        )}
                    >
                        <Menu3 className="h-5 w-5 shrink-0" aria-hidden="true" />
                        {!collapsed && (
                            <span className="text-sm font-semibold text-content-emphasis truncate">
                                {tc('appName')}
                            </span>
                        )}
                    </button>
                ) : (
                    <div className="flex items-center gap-tight">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--brand-emphasis)] to-[var(--brand-default)] flex items-center justify-center flex-shrink-0">
                            <span className="text-content-inverted text-sm font-bold">IS</span>
                        </div>
                        <span className="text-sm font-semibold text-content-emphasis truncate">
                            {tc('appName')}
                        </span>
                    </div>
                )}
            </div>

            {/* Nav */}
            <nav className="flex-1 p-2 overflow-y-auto" aria-label={tn('mainNavigation')}>
                {sections.map((section, idx) => (
                    <NavSection
                        key={idx}
                        title={section.title}
                        // R12-PR3 — suppress the top hairline on
                        // the first titled section (the very top
                        // of the sidebar). The untitled My Work
                        // section sits at idx 0; the first titled
                        // section is "Workspace" at idx 1.
                        isFirst={idx === 0 || sections.findIndex((s) => s.title) === idx}
                    >
                        {section.items.map((item) => (
                            <NavItem
                                key={item.href}
                                href={item.href}
                                icon={item.icon}
                                label={item.label}
                                badge={item.badge}
                                badgeLabel={item.badgeLabel}
                                active={pathname.startsWith(item.href)}
                                onClick={onNavClick}
                            />
                        ))}
                    </NavSection>
                ))}
            </nav>

            {/* Roadmap-2 PR-3 — inline command-palette opener.
                Sits below the scrolling nav and above the user
                block. The chrome's `<SearchAnchor>` is the
                primary affordance on desktop; this row is the
                mobile equivalent (chrome is hidden on <md) AND
                a discoverable secondary anchor on desktop. */}
            <button
                type="button"
                onClick={() => {
                    onNavClick?.();
                    openPalette();
                }}
                className={cn(
                    'mx-2 mb-2 flex items-center rounded-lg border border-border-subtle bg-bg-default px-3 py-2 text-xs text-content-muted transition-colors hover:bg-bg-muted hover:text-content-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                    collapsed ? 'justify-center' : 'gap-tight',
                )}
                // 2.5.3 again, same shape: expanded, the visible text is
                // `common.search`, and the label has to carry it. The ellipsis
                // is part of that visible string, so it is interpolated rather
                // than re-spelled — a hand-written "Search" would not match
                // what is on screen.
                // SECOND ATTEMPT, and the first is worth recording. Putting
                // `common.search` INTO the label was not enough: axe curates
                // both sides with `removeUnicode(…, {punctuations: true})` and
                // asks `acc.includes(visible)`, and this button's visible run
                // does not stop at "Search…" — it ends with the ⌘/K shortcut
                // badge below, so the visible text curated to roughly
                // "search k", which no label naming only the word contains.
                //
                // Dropping the label when EXPANDED makes the accessible name
                // the content, so the comparison holds by construction whatever
                // the badge renders. Collapsed, the button is icon-only with no
                // visible text, so a label is required and 2.5.3 is silent.
                aria-label={collapsed ? tn('openCommandPalette') : undefined}
                data-testid="sidebar-search-anchor"
            >
                <svg
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <circle cx="7" cy="7" r="5" />
                    <path d="M11 11l3 3" />
                </svg>
                {!collapsed && <span className="flex-1 text-left">{tc('search')}</span>}
                {!collapsed && (
                    <span
                        className="hidden items-center gap-[2px] rounded border border-border-subtle bg-bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-content-subtle md:flex"
                        aria-hidden="true"
                    >
                        <span>⌘</span>
                        <span>K</span>
                    </span>
                )}
            </button>

            {/* User. Settings + Sign-out sit on a single horizontal
                row, vertically centred against the three-line
                identity (name / workspace / role). The role row is
                the literal last line of the sidebar. Collapsed:
                identity text is dropped and the icons stack centred
                in the rail. */}
            <div className="p-3 border-t border-border-subtle">
                <div className={cn('flex gap-tight', collapsed ? 'flex-col items-center' : 'items-center justify-between')}>
                    {!collapsed && (
                        <div className="min-w-0">
                            <p className="text-xs font-medium text-content-default truncate">{user.name}</p>
                            <p className="text-xs text-content-muted truncate">{tenant.tenantName}</p>
                            {/* GAP-CI-77: role uses content-muted (not brand-default).
                                The light-theme orange brand colour on light cream is only
                                4.25:1 — below WCAG AA's 4.5:1 for small text — and
                                the role line is informational, not a brand
                                accent. */}
                            <p className="text-xs text-content-muted">
                                {tRoles.has?.(tenant.role) ? tRoles(tenant.role) : tenant.role}
                            </p>
                        </div>
                    )}
                    <div className={cn('flex gap-tight', collapsed ? 'flex-col items-center' : 'items-center')}>
                        {/* `admin.view` AND the membership's own role, as the
                            edge reads it: a custom role's `admin.view` on a
                            Member or Viewer membership does not open Settings
                            (`mayOpenSettings`). */}
                        {mayOpenSettings && (
                            <Tooltip content={tn('settings')} side={collapsed ? 'right' : 'top'}>
                                <Link
                                    href={tenantHref(NAV_PATHS.settings)}
                                    aria-label={tn('settings')}
                                    id="settings-icon-link"
                                    data-testid="nav-settings-icon"
                                    className="icon-btn icon-btn-sm"
                                >
                                    <Gear className="size-4" aria-hidden="true" />
                                </Link>
                            </Tooltip>
                        )}
                        <Tooltip content={tc('signOut')} side={collapsed ? 'right' : 'top'}>
                            <button
                                type="button"
                                onClick={onLogout}
                                aria-label={tc('signOut')}
                                data-testid="nav-logout"
                                className="icon-btn icon-btn-sm"
                            >
                                <UserArrowRight className="size-4" aria-hidden="true" />
                            </button>
                        </Tooltip>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Mobile Drawer — REMOVED (T07, #3076) ───
//
// `MobileDrawer` lived here: a hand-rolled backdrop + panel + `inert`
// bookkeeping, i.e. a second overlay implementation beside the Sheet
// primitive, drifting from it. The phone drawer is now
// `MobileNavDrawer` on `Sheet direction="left"` — T03 added that
// direction for exactly this. The behaviours the hand-rolled version had
// earned did not come for free and are reinstated explicitly there; its
// header is the record of which, and why each.
//
// Nothing imports this any more, so it is gone rather than deprecated: a
// second drawer kept alive is the drift this task removed.
