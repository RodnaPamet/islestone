/** @jest-environment jsdom */

/**
 * A theme is STORED only when the user picks one.
 *
 * inflect-compliance's `ThemeProvider` used to write a one-year theme cookie
 * and a localStorage entry with the OS light/dark setting on every first
 * visit, before anyone chose anything. So did the pre-paint script. Reading
 * `prefers-color-scheme` needs no storage, and a UI-customisation cookie is exempt
 * from consent only when the user asked for the preference to be kept (Article 29
 * WP194). A host that vendors this provider was about to tell its visitors it sets
 * "only essential cookies", and that sentence would have been false on the first
 * page view.
 *
 * Every write is observed at the SOURCE, not inferred from what is stored
 * afterwards: `document.cookie`'s setter and `Storage.prototype.setItem` are
 * wrapped, so a write that stored the same value as before still counts. The OS
 * preference is a controllable `matchMedia` double, because jsdom has none.
 *
 * Copied from inflect-compliance at 5528464fc54a8681956f3b9ce23ca9c075f0420e
 * (sub-phase 1.7). As there, the theme follows the OS colour scheme until the
 * person chooses (owner decision, 2026-11-19; docs/HANDOFF.md row 38); the
 * cases cover a dark system, a light system, and a choice overriding either.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { ThemeProvider, useTheme } from '@/components/theme/ThemeProvider';
import { THEME_COOKIE, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from '@/lib/theme-constants';

// ─── The OS: a controllable prefers-color-scheme ────────────────────────

type ChangeListener = (event: MediaQueryListEvent) => void;

let systemLight = false;
let listeners: Array<{ query: string; fn: ChangeListener }> = [];

/** What a query reports for the current system setting. */
const matchesFor = (query: string) => (query === '(prefers-color-scheme: light)' ? systemLight : !systemLight);

// tests/rendered/setup.ts installs a writable (not configurable) static stub;
// this one is assigned over it per test and the stub is put back afterwards.
const setupMatchMedia = window.matchMedia;

function installMatchMedia() {
    window.matchMedia = ((query: string) => ({
        get matches() {
            return matchesFor(query);
        },
        media: query,
        onchange: null,
        addEventListener: (_type: string, fn: ChangeListener) => {
            listeners.push({ query, fn });
        },
        removeEventListener: (_type: string, fn: ChangeListener) => {
            listeners = listeners.filter((l) => l.fn !== fn);
        },
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
}

/** The OS flips while the page is open. */
function systemSwitchesTo(theme: 'light' | 'dark') {
    systemLight = theme === 'light';
    act(() => {
        for (const { query, fn } of listeners) fn({ matches: matchesFor(query), media: query } as MediaQueryListEvent);
    });
}

// ─── Every write, at the source ─────────────────────────────────────────

const cookieAccessor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!;
const realSetItem = Storage.prototype.setItem;
let cookieWrites: string[] = [];
let storageWrites: Array<[string, string]> = [];

function recordWrites() {
    cookieWrites = [];
    storageWrites = [];
    Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => cookieAccessor.get!.call(document),
        set: (value: string) => {
            cookieWrites.push(value);
            cookieAccessor.set!.call(document, value);
        },
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
        this: Storage,
        key: string,
        value: string,
    ) {
        storageWrites.push([key, value]);
        realSetItem.call(this, key, value);
    });
}

const themeWrites = () => ({
    cookie: cookieWrites.filter((w) => w.startsWith(`${THEME_COOKIE}=`)),
    storage: storageWrites.filter(([key]) => key === THEME_STORAGE_KEY),
});

/** Seed a choice made on an EARLIER visit, without it counting as a write here. */
function seedCookie(value: 'light' | 'dark') {
    cookieAccessor.set!.call(document, `${THEME_COOKIE}=${value}; path=/`);
}
function seedStorage(value: 'light' | 'dark') {
    realSetItem.call(window.localStorage, THEME_STORAGE_KEY, value);
}

function clearStoredTheme() {
    cookieAccessor.set!.call(document, `${THEME_COOKIE}=; path=/; max-age=0`);
    window.localStorage.clear();
}

// ─── A consumer: shows the theme and offers the user's own choice ────────

function Probe() {
    const { theme, toggle } = useTheme();
    return (
        <div>
            <output data-testid="theme">{theme}</output>
            <button type="button" onClick={toggle}>
                Toggle theme
            </button>
        </div>
    );
}

function renderApp() {
    return render(
        <ThemeProvider>
            <Probe />
        </ThemeProvider>,
    );
}

const shownTheme = () => screen.getByTestId('theme').textContent;
const htmlTheme = () => document.documentElement.getAttribute('data-theme');

beforeEach(() => {
    systemLight = false;
    listeners = [];
    installMatchMedia();
    clearStoredTheme();
    document.documentElement.removeAttribute('data-theme');
    recordWrites();
});

afterEach(() => {
    jest.restoreAllMocks();
    window.matchMedia = setupMatchMedia;
    // Drop the instance accessor so the prototype's real one is used again.
    delete (document as unknown as { cookie?: string }).cookie;
    clearStoredTheme();
});

// ─── ThemeProvider ──────────────────────────────────────────────────────

describe('ThemeProvider — the OS until a choice, stored only when the user picks one', () => {
    it('on a dark system, a first visit is dark and writes NOTHING', () => {
        systemLight = false;
        renderApp();

        expect(shownTheme()).toBe('dark');
        expect(htmlTheme()).toBe('dark');
        expect(themeWrites()).toEqual({ cookie: [], storage: [] });
        expect(document.cookie).not.toContain(`${THEME_COOKIE}=`);
        expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    });

    it('on a light system, a first visit is light and writes NOTHING', () => {
        systemLight = true;
        renderApp();

        expect(shownTheme()).toBe('light');
        expect(htmlTheme()).toBe('light');
        expect(themeWrites()).toEqual({ cookie: [], storage: [] });
    });

    it('with nothing stored it keeps following the OS while open, still writing nothing', () => {
        systemLight = true;
        renderApp();
        expect(shownTheme()).toBe('light');

        systemSwitchesTo('dark');
        expect(shownTheme()).toBe('dark');
        expect(htmlTheme()).toBe('dark');

        systemSwitchesTo('light');
        expect(shownTheme()).toBe('light');
        expect(themeWrites()).toEqual({ cookie: [], storage: [] });
    });

    it('the user toggling writes BOTH the cookie and localStorage', () => {
        systemLight = true;
        renderApp();
        fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));

        expect(shownTheme()).toBe('dark');
        expect(htmlTheme()).toBe('dark');
        expect(themeWrites().cookie).toHaveLength(1);
        expect(themeWrites().cookie[0]).toMatch(new RegExp(`^${THEME_COOKIE}=dark;`));
        expect(themeWrites().storage).toEqual([[THEME_STORAGE_KEY, 'dark']]);
        expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    });

    it('once the user has chosen, the OS no longer moves the theme', () => {
        systemLight = true;
        renderApp();
        fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));
        systemSwitchesTo('light');
        expect(shownTheme()).toBe('dark');
        systemSwitchesTo('dark');
        systemSwitchesTo('light');
        expect(shownTheme()).toBe('dark');
    });

    it('a stored choice overrides the system, and mounting does not write it again', () => {
        seedCookie('light');
        systemLight = false;
        renderApp();

        expect(shownTheme()).toBe('light');
        expect(htmlTheme()).toBe('light');
        systemSwitchesTo('dark');
        expect(shownTheme()).toBe('light');
        expect(themeWrites()).toEqual({ cookie: [], storage: [] });
    });

    it('a localStorage-only choice still overrides the system, and is not copied into a cookie on mount', () => {
        seedStorage('dark');
        systemLight = true;
        renderApp();

        expect(shownTheme()).toBe('dark');
        expect(themeWrites()).toEqual({ cookie: [], storage: [] });
        expect(document.cookie).not.toContain(`${THEME_COOKIE}=`);
    });
});

// ─── The pre-paint script ───────────────────────────────────────────────

describe('THEME_INIT_SCRIPT — the pre-paint script follows the same rule', () => {
    // The script is what the root layout inlines in <head>. Executed here as a
    // browser would, so the assertion is about what it DOES.
    const runScript = () => new Function(THEME_INIT_SCRIPT)();

    it('on a dark system with nothing stored it paints dark, writing nothing', () => {
        systemLight = false;
        runScript();
        expect(htmlTheme()).toBe('dark');
        expect(themeWrites()).toEqual({ cookie: [], storage: [] });
        expect(document.cookie).not.toContain(`${THEME_COOKIE}=`);
    });

    it('on a light system with nothing stored it paints light', () => {
        systemLight = true;
        runScript();
        expect(htmlTheme()).toBe('light');
        expect(themeWrites()).toEqual({ cookie: [], storage: [] });
    });

    it('paints a stored cookie choice over the system, without writing', () => {
        seedCookie('light');
        systemLight = false;
        runScript();
        expect(htmlTheme()).toBe('light');
        expect(themeWrites()).toEqual({ cookie: [], storage: [] });
    });

    it('paints a localStorage-only choice over the system, without writing', () => {
        seedStorage('dark');
        systemLight = true;
        runScript();
        expect(htmlTheme()).toBe('dark');
        expect(themeWrites()).toEqual({ cookie: [], storage: [] });
    });

    it('paints light where the browser has no matchMedia', () => {
        (window as unknown as { matchMedia?: unknown }).matchMedia = undefined;
        runScript();
        expect(htmlTheme()).toBe('light');
    });
});
