/** @jest-environment jsdom */

/**
 * A project's due date in the browser (roadmap 3.1a; owner decision 188):
 * the project page's header shows it, and offers "Change due date" only to a
 * viewer the server says may change the project, whose save is a PATCH of the
 * project route; the Projects list shows it in its own column. Queries by
 * role and label; jest-axe on the dialog.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: mockRefresh, back: jest.fn() }),
    usePathname: () => '/t/acme/projects/ISL',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { ProjectDueDate } from '@/components/projects/ProjectDueDate';
import { ProjectsList } from '@/components/work-items/ProjectsList';

import { CONFIG, installFetch, renderWorkspace } from '../helpers/work-items-harness';

describe("a project's due date", () => {
    it('shows the date and sends a change through the project route', async () => {
        const { calls } = installFetch({ 'PATCH /projects/p-1': { body: { id: 'p-1', dueDate: '2027-03-14' } } });
        renderWorkspace(<ProjectDueDate projectId="p-1" projectName="Islands" dueDate="2027-03-14" canEdit />);
        expect(screen.getByText('Due 2027-03-14')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Change due date' }));
        const dialog = await screen.findByRole('dialog', { name: 'Due date of Islands' });
        expect(await axe(dialog)).toHaveNoViolations();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ dueDate: '2027-03-14' }));
        expect(calls.find((c) => c.method === 'PATCH')?.path).toBe('/projects/p-1');
        await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    });

    it('says when there is none, and offers no change without the server\'s say-so', () => {
        installFetch({});
        renderWorkspace(<ProjectDueDate projectId="p-1" projectName="Islands" dueDate={null} canEdit={false} />);
        expect(screen.getByText('No due date')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Change due date' })).toBeNull();
    });

    it('is a column of the Projects list', () => {
        installFetch({});
        const projects = CONFIG.projects.map((p, i) => ({ ...p, dueDate: i === 0 ? '2027-03-14' : null }));
        renderWorkspace(<ProjectsList title="Projects" projects={projects} teams={CONFIG.teams} mayCreateProject={false} />);
        expect(screen.getByRole('columnheader', { name: 'Due date' })).toBeInTheDocument();
        const row = screen.getByRole('link', { name: projects[0]!.name }).closest('tr')!;
        expect(within(row).getByText('2027-03-14')).toBeInTheDocument();
    });
});
