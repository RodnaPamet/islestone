import { render, screen } from '@testing-library/react';

import HomePage from '@/app/page';

describe('home page', () => {
    it('names the product in its only top-level heading', () => {
        render(<HomePage />);

        const headings = screen.getAllByRole('heading', { level: 1 });
        expect(headings).toHaveLength(1);
        expect(headings[0]).toHaveTextContent('Islestone');
    });

    it('renders inside a main landmark', () => {
        render(<HomePage />);

        expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1 }));
    });
});
