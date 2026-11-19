# Application shell

Sub-phase 1.7. The chrome around every workspace page: the sidebar, the top
chrome, the mobile drawer, the command palette, the shortcut help, the theme,
and the page shells a feature page is built from.

Copied and edited from inflect-compliance at
`5528464fc54a8681956f3b9ce23ca9c075f0420e` (`PROVENANCE.md`, "Copied:
application shell"); the navigation, the palette's commands and the
placeholder pages are written fresh. The decisions below are distilled from
the parent's notes on its entity-page architecture, list-page shell, theme
flash fix and i18n, which are not copied.

## The route tree

```
src/app/layout.tsx                 html, locale, theme, CSP nonce, <Providers>
src/app/providers.tsx              SWR session seam, shortcuts, palette, theme,
                                   tooltips, toasts, shortcut help
src/app/t/[tenantSlug]/(app)/      every workspace page
  layout.tsx                       session → getTenantServerContext →
                                   TenantProvider → AppShell
  page.tsx                         → My Work
  my-work, inbox, projects, views, settings
src/app/t/[tenantSlug]/(mfa)/      the MFA challenge and enrolment, outside
                                   the shell
```

The `(app)` layout is the security boundary. It resolves the workspace through
`getTenantServerContext`, the page-side gate 1.4 wrote: an active membership,
and the workspace MFA check. A slug the person is not in, or one that names no
workspace, is a 404, so a slug never reveals whether a workspace exists and no
one sees another workspace's shell. A workspace that still wants this
session's MFA code sends the page to its challenge; that is why the challenge
and enrolment pages live in `(mfa)`, outside the layout. The layout runs
`noStore()` and `force-dynamic`, so permissions are read per request.

The parent splits this into a `[tenantSlug]/layout.tsx` (the context) and an
`(app)/layout.tsx` (the shell). Islestone merges them because its page-side
context carries the MFA gate, which must not wrap the MFA pages.

## Navigation

`src/components/layout/nav-config.ts` is the navigation:

| Route | Label | Where |
|---|---|---|
| `/my-work` | My Work | sidebar, first; the landing page |
| `/inbox` | Inbox | sidebar |
| `/projects` | Projects | sidebar, "Workspace" |
| `/views` | Views | sidebar, "Workspace" |
| `/settings` | Settings | the footer gear |

The words are ADR 0006's. Settings shows only to a member who holds
`admin.view` on a membership whose own built-in role opens the admin console
(`mayOpenSettings`); the page asks the same on the server. Until their
features arrive each route is a placeholder (`PlaceholderPage`): Inbox and My
Work in 2.7, Views in 2.4, Projects in 2.1 and 2.3.

A new route is added in four places: `NAV_PATHS`, `MAIN_PAGES` in
`src/lib/nav/page-segregation.ts` (or `SUBPAGES` with a `canonical-parents.ts`
entry), `common.sections` (the back affordance's label) and the catalogue.
`tests/guards/page-segregation-coverage.test.ts` fails on an unclassified page.

## Page shells

| Shell | For | Brings |
|---|---|---|
| `EntityListPage` | a list of records | `PageHeader`, `FilterToolbar`, `DataTable` with `fillBody`, inside `ListPageShell` |
| `EntityDetailLayout` | one record | back link, title, the record stepper, meta, actions, tabs, an optional rail, loading/error/empty states |
| `DashboardLayout` | an overview | `PageHeader` and sections |

The shells carry layout, not content: columns, filters, data fetching,
mutations and modals stay in the page. `ListPageShell` clamps the table to the
viewport so the header, filters and pagination stay put and only the rows
scroll; on a phone the page scrolls. `PageHeader` reads the page's class:
on a main page its H1 is kept for screen readers but hidden.

## The command palette and shortcuts

`mod+k` (Ctrl+K, ⌘K) opens the palette; the sidebar's search row does too. It
lists the navigation (from `NAV_PATHS`) and the safe actions (toggle theme,
sign out; ask the assistant once 6.4 registers it), filters them as you type,
and lists the registered shortcuts. Entity search (work items, projects) is
switched off until 2.7 ships `GET /api/t/<slug>/search`.

Every shortcut is registered through `useKeyboardShortcut` with a
`description`; the registry owns the one `keydown` listener, ignores keys
while you type, and feeds the palette and the help overlay (`mod+/`; not `?`,
which WCAG 2.1.4 forbids as a single-key shortcut).

## Theme

The palette is `data-theme` on `<html>`, light by default. The root layout
renders it from the theme cookie, so a member who chose a theme gets it on the
first byte; a pre-paint script applies a choice kept only in localStorage. A
theme is written only when a member picks one. Islestone does not follow the
operating system's colour scheme, which the parent does: that is an owner
decision (`docs/HANDOFF.md`). The constants live in
`src/lib/theme-constants.ts`, which must never be a client module: the server
layout imports them, and a value from a `'use client'` module is a proxy on
the server.

## Copy

Every string is a key in `messages/en.json`, added key by key. One locale
ships; the switcher, the locale cookie (`islestone_locale`) and the request
config are ready for a second. `tests/guards/i18n-keys-resolve.test.ts`
resolves every literal key, and `tests/guards/i18n-adoption.test.ts` refuses
hard-coded copy in `src/components`.
