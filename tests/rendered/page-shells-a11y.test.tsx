/** @jest-environment jsdom */

/**
 * The three page shells (sub-phase 1.7) render without an axe violation in
 * the configurations a page uses them in: `EntityListPage` with a header,
 * filters and a table; `EntityDetailLayout` with a back link, tabs and a
 * body; `DashboardLayout` with a header and sections. Each case also checks
 * the shell's landmark contract, so an empty render cannot pass.
 *
 * Each renders inside `<main>`, where `AppShellFrame` places every page: a
 * page header's `<header>` is a banner only at the top level, and inside
 * `<main>` it is not (axe `landmark-banner-is-top-level`).
 */
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { CheckCircle } from 'lucide-react';
import * as React from 'react';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
    usePathname: () => '/t/acme/projects/p1',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { TooltipProvider } from '@inflect/ui/components/ui/tooltip';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { EntityDetailLayout } from '@/components/layout/EntityDetailLayout';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { createFilterDefs, FilterProvider, useFilterContext } from '@/components/ui/filter';
import { createColumns } from '@/components/ui/table';
import { KeyboardShortcutProvider } from '@/lib/hooks/use-keyboard-shortcut';

interface Row {
    id: string;
    name: string;
    status: string;
}

const rows: Row[] = [
    { id: 'a', name: 'Website relaunch', status: 'ACTIVE' },
    { id: 'b', name: 'Billing migration', status: 'PAUSED' },
];

const columns = createColumns<Row>([
    { id: 'name', header: 'Name', cell: ({ row }) => row.original.name },
    { id: 'status', header: 'Status', cell: ({ row }) => row.original.status },
]);

const { filters, filterKeys } = createFilterDefs({
    status: {
        label: 'Status',
        icon: CheckCircle,
        options: [
            { value: 'ACTIVE', label: 'Active' },
            { value: 'PAUSED', label: 'Paused' },
        ],
    },
});

function WithFilters({ children }: { children: React.ReactNode }) {
    const ctx = useFilterContext(filters, filterKeys);
    return <FilterProvider value={ctx}>{children}</FilterProvider>;
}

function Providers({ children }: { children: React.ReactNode }) {
    return (
        <TooltipProvider>
            <KeyboardShortcutProvider>
                <main>{children}</main>
            </KeyboardShortcutProvider>
        </TooltipProvider>
    );
}

describe('page shells — accessibility', () => {
    it('EntityListPage: header, filter toolbar and table', async () => {
        const { container } = render(
            <Providers>
                <WithFilters>
                    <EntityListPage<Row>
                        header={{ title: 'Projects', count: '2 projects' }}
                        filters={{ defs: filters, searchId: 'project-search', searchPlaceholder: 'Search projects…' }}
                        table={{ data: rows, columns, getRowId: (r) => r.id, 'data-testid': 'projects-table' }}
                    />
                </WithFilters>
            </Providers>,
        );
        expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
        expect(screen.getByText('Website relaunch')).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
    });

    it('EntityDetailLayout: back link, title, tabs and body', async () => {
        const { container } = render(
            <Providers>
                <EntityDetailLayout
                    back={{ href: '/t/acme/projects', label: 'Projects' }}
                    title="Website relaunch"
                    tabs={[
                        { key: 'overview', label: 'Overview' },
                        { key: 'activity', label: 'Activity', count: 3 },
                    ]}
                    activeTab="overview"
                    onTabChange={() => {}}
                >
                    <p>Overview body</p>
                </EntityDetailLayout>
            </Providers>,
        );
        expect(screen.getByRole('heading', { level: 1, name: 'Website relaunch' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true');
        expect(await axe(container)).toHaveNoViolations();
    });

    it('DashboardLayout: header and sections', async () => {
        const { container } = render(
            <Providers>
                <DashboardLayout header={{ title: 'Overview', description: 'This week in the workspace.' }}>
                    <section aria-label="Due soon">
                        <p>Nothing is due.</p>
                    </section>
                </DashboardLayout>
            </Providers>,
        );
        expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Due soon' })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
    });
});
