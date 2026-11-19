/**
 * `<LocaleSwitcher>` — visible short code, accessible full endonym.
 *
 * The switcher shows "EN" / "FR" but must keep "English" / "Français" as the
 * ACCESSIBLE NAME of each radio: `ToggleGroupOption` carries no per-option
 * aria-label, so the accname of a `role="radio"` is computed from its
 * contents, and a bare short code would leave screen readers announcing "EN".
 *
 * Each assertion pairs the two halves — `getByRole('radio', { name })` looks
 * the option up BY its accessible name and then checks the rendered text — so
 * a single test fails if either half regresses: the short code being lost, or
 * the accessible name collapsing to the short code.
 *
 * Islestone ships one locale (`SUPPORTED_LOCALES = ['en']`), so this suite
 * mocks a second, French, to exercise the switch itself: the component is
 * built to take a second catalogue with no change of its own.
 */
/** @jest-environment jsdom */

import * as React from 'react';
import { fireEvent, render } from '@testing-library/react';

import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
import * as localeConstants from '@/lib/locale-constants';

// The mocked second locale; the module's own types know only `en`.
const LOCALE_LABELS = localeConstants.LOCALE_LABELS as Record<'en' | 'fr', string>;
const LOCALE_SHORT_LABELS = localeConstants.LOCALE_SHORT_LABELS as Record<'en' | 'fr', string>;
const { LOCALE_COOKIE } = localeConstants;

jest.mock('@/lib/locale-constants', () => {
    const actual = jest.requireActual('@/lib/locale-constants');
    const SUPPORTED_LOCALES = ['en', 'fr'] as const;
    const isSupportedLocale = (value: unknown) =>
        typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
    return {
        ...actual,
        SUPPORTED_LOCALES,
        LOCALE_LABELS: { en: 'English', fr: 'Français' },
        LOCALE_SHORT_LABELS: { en: 'EN', fr: 'FR' },
        isSupportedLocale,
        resolveLocale: (value: unknown) => (isSupportedLocale(value) ? value : 'en'),
    };
});

// Hoisted so the assertion has a stable handle. An inline
// `useRouter: () => ({ refresh: jest.fn() })` returns a FRESH mock on every
// call, leaving nothing to assert against.
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: mockRefresh }),
}));

beforeEach(() => {
    mockRefresh.mockClear();
    document.cookie = `${LOCALE_COOKIE}=; path=/; max-age=0`;
});

describe('LocaleSwitcher — label vs accessible name', () => {
    it('shows the short code while keeping the endonym as the accessible name', () => {
        const { getByRole } = render(<LocaleSwitcher />);

        const en = getByRole('radio', { name: LOCALE_LABELS.en });
        expect(en.textContent).toContain(LOCALE_SHORT_LABELS.en);
        expect(en.textContent).not.toContain(LOCALE_SHORT_LABELS.fr);

        const fr = getByRole('radio', { name: LOCALE_LABELS.fr });
        expect(fr.textContent).toContain(LOCALE_SHORT_LABELS.fr);
    });

    it('labels the group so the two-letter codes have context', () => {
        const { getByRole } = render(<LocaleSwitcher />);
        expect(getByRole('radiogroup', { name: 'Language' })).toBeTruthy();
    });

    it('marks the active locale checked (useLocale is mocked to "en")', () => {
        const { getByRole } = render(<LocaleSwitcher />);
        expect(
            getByRole('radio', { name: LOCALE_LABELS.en }).getAttribute('aria-checked'),
        ).toBe('true');
        expect(
            getByRole('radio', { name: LOCALE_LABELS.fr }).getAttribute('aria-checked'),
        ).toBe('false');
    });
});

describe('LocaleSwitcher — selection', () => {
    it('persists the cookie and refreshes the server tree on select', () => {
        const { getByRole } = render(<LocaleSwitcher />);

        fireEvent.click(getByRole('radio', { name: LOCALE_LABELS.fr }));

        expect(document.cookie).toContain(`${LOCALE_COOKIE}=fr`);
        expect(mockRefresh).toHaveBeenCalled();
    });

    it('does not re-persist or refresh when the active locale is re-selected', () => {
        const { getByRole } = render(<LocaleSwitcher />);

        fireEvent.click(getByRole('radio', { name: LOCALE_LABELS.en }));

        expect(mockRefresh).not.toHaveBeenCalled();
    });
});
