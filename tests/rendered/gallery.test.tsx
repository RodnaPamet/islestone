import { render, screen, within } from '@testing-library/react';

import { Gallery } from '@/app/gallery/gallery';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
    usePathname: () => '/gallery',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({}),
}));

describe('UI gallery', () => {
    it('renders one panel per theme, each pinned with data-theme', () => {
        render(<Gallery />);

        const light = screen.getByRole('region', { name: 'Light theme' });
        const dark = screen.getByRole('region', { name: 'Dark theme' });
        expect(light).toHaveAttribute('data-theme', 'light');
        expect(dark).toHaveAttribute('data-theme', 'dark');
    });

    it.each(['Light theme', 'Dark theme'])('%s shows the main primitives', (name) => {
        render(<Gallery />);
        const panel = within(screen.getByRole('region', { name }));

        expect(panel.getByRole('button', { name: 'Primary' })).toBeInTheDocument();
        expect(panel.getByRole('checkbox', { name: 'Notify the assignee' })).toBeChecked();
        expect(panel.getByRole('switch', { name: 'Visible to guests' })).toBeChecked();
        expect(panel.getByRole('radiogroup', { name: 'Priority' })).toBeInTheDocument();
        expect(panel.getByRole('textbox', { name: 'Title' })).toBeInTheDocument();
        expect(panel.getByRole('table')).toHaveTextContent('Ship the gallery');
        expect(panel.getByText('No items yet')).toBeInTheDocument();
    });
});
