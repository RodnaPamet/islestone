/**
 * The root error and 404 pages send a person to the workspace picker at
 * /tenants (inflect-compliance #5093), and say so: their labels name the
 * workspaces, not My Work.
 *
 * Copied from inflect-compliance at 5528464fc54a8681956f3b9ce23ca9c075f0420e
 * (sub-phase 1.7). The legacy /dashboard shim's case is not: Islestone never
 * had the route. The root error boundary's case is new.
 */
import { render, screen } from '@testing-library/react';

jest.mock('next-intl/server', () => ({
    getTranslations: async () => (key: string) => key,
}));

import RootError from '@/app/error';
import NotFound from '@/app/not-found';

it('the 404 page links to the workspace picker', async () => {
    render(await NotFound());
    expect(screen.getByRole('link', { name: 'returnToWorkspaces' })).toHaveAttribute('href', '/tenants');
});

it('the root error page offers the workspace picker and shows the error id', () => {
    // The click itself is a full page load (`window.location.assign`), which
    // jsdom does not implement; the label is what names the destination.
    render(<RootError error={Object.assign(new Error('boom'), { digest: 'd1' })} reset={() => {}} />);
    expect(screen.getByRole('button', { name: 'Go to your workspaces' })).toBeInTheDocument();
    expect(screen.getByText('Error ID: d1')).toBeInTheDocument();
});
