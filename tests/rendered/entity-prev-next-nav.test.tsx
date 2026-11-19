/** @jest-environment jsdom */

/**
 * `<EntityPrevNextNav>` — the up/down record stepper beside a detail-page name.
 *
 * Two invariants, both of which were broken or latent before this suite:
 *
 * 1. It RENDERS when given real list ids. The component once hid itself
 *    because its caller fed it `[]` after a list changed response shape, and
 *    a structural guard that asserted only that the source *mentioned* the
 *    component passed the whole time the feature was dead. These assertions
 *    fail instead.
 *
 * 2. Its keyboard binding requires ALT. `useKeyboardShortcut` defaults
 *    `preventDefault` to true and binds on `window`, so a bare ArrowUp/Down
 *    binding would stop the arrow keys scrolling the detail page.
 *
 * 3. Its labels come from the message catalog, as whole phrases per entity
 *    and direction (`ui.recordStepper`), never an adjective interpolated
 *    into a noun, so a second locale can phrase each pair its own way.
 *
 * Copied from inflect-compliance at 5528464fc54a8681956f3b9ce23ca9c075f0420e
 * (sub-phase 1.7): English only (Islestone ships one catalogue), the generic
 * `item` phrase (the compliance entity slugs are gone; 2.3 adds `workItem`),
 * and plain id arrays in place of `idsFromCappedList`, which is not ported.
 */

import { fireEvent, render, within } from '@testing-library/react';
import * as React from 'react';

import enCatalog from '../../messages/en.json';

import {
    EntityPrevNextNav,
    STEPPER_ENTITIES,
} from '@/components/layout/entity-prev-next-nav';
import {
    KeyboardShortcutProvider,
    useRegisteredShortcuts,
} from '@/lib/hooks/use-keyboard-shortcut';
import { TooltipProvider } from '@inflect/ui/components/ui/tooltip';

/**
 * Why a LOCAL mock rather than the repo-wide `__mocks__/next-intl.js`:
 *
 *   • the shared one hands back a FRESH `t` on every `useTranslations()` call. Any
 *     consumer that feeds `t` (or a value derived from it) into a hook
 *     dependency then re-registers on every render, and the suite TIMES OUT
 *     rather than failing — a slow, confusing way to find out. Memoising one
 *     `t` per (locale, namespace) makes the identity stable.
 */
jest.mock('next-intl', () => {
    const catalog: unknown = jest.requireActual('../../messages/en.json');
    type Translator = ((key: string) => string) & { has: (key: string) => boolean };
    const build = (ns: string): Translator => {
        const resolve = (key: string): unknown =>
            `${ns}.${key}`
                .split('.')
                .reduce<unknown>(
                    (o, k) =>
                        o && typeof o === 'object'
                            ? (o as Record<string, unknown>)[k]
                            : undefined,
                    catalog,
                );
        return Object.assign(
            (key: string) => {
                const v = resolve(key);
                return typeof v === 'string' ? v : key;
            },
            { has: (key: string) => typeof resolve(key) === 'string' },
        );
    };
    const cache = new Map<string, Translator>();
    return {
        useTranslations: (ns: string): Translator => {
            let t = cache.get(ns);
            if (!t) {
                t = build(ns);
                cache.set(ns, t);
            }
            return t;
        },
        useLocale: () => 'en',
    };
});

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({
        push: jest.fn(),
        replace: mockReplace,
        back: jest.fn(),
        forward: jest.fn(),
        refresh: jest.fn(),
        prefetch: jest.fn(),
    }),
}));

const hrefFor = (id: string) => `/t/acme/projects/${id}`;

function mount(ids: string[], currentId: string, labelSingular = 'item') {
    return render(
        <TooltipProvider delayDuration={0}>
            <KeyboardShortcutProvider>
                <EntityPrevNextNav
                    ids={ids}
                    currentId={currentId}
                    hrefFor={hrefFor}
                    labelSingular={labelSingular}
                />
            </KeyboardShortcutProvider>
        </TooltipProvider>,
    );
}

beforeEach(() => {
    mockReplace.mockClear();
});

describe('EntityPrevNextNav — renders for a real list payload', () => {
    // Ids in the order the list showed them.
    const listIds = ['a1', 'a2', 'a3'];

    it('mounts both steppers for a mid-list record', () => {
        const ids = listIds;
        const { queryByTestId } = mount(ids, 'a2');
        expect(queryByTestId('entity-prev-next-nav')).not.toBeNull();
        expect(queryByTestId('entity-nav-prev')).not.toBeNull();
        expect(queryByTestId('entity-nav-next')).not.toBeNull();
    });

    it('steps to the previous and next neighbour in list order', () => {
        const ids = listIds;
        const { getByTestId } = mount(ids, 'a2');

        fireEvent.click(getByTestId('entity-nav-prev'));
        expect(mockReplace).toHaveBeenCalledWith(hrefFor('a1'));

        mockReplace.mockClear();
        fireEvent.click(getByTestId('entity-nav-next'));
        expect(mockReplace).toHaveBeenCalledWith(hrefFor('a3'));
    });

    it('disables the ends rather than wrapping around', () => {
        const ids = listIds;
        const first = mount(ids, 'a1');
        expect(first.getByTestId('entity-nav-prev').hasAttribute('disabled')).toBe(true);
        expect(first.getByTestId('entity-nav-next').hasAttribute('disabled')).toBe(false);
        first.unmount();

        const last = mount(ids, 'a3');
        expect(last.getByTestId('entity-nav-next').hasAttribute('disabled')).toBe(true);
    });

    it('hides itself when there is nothing to step through', () => {
        expect(mount(['only'], 'only')
            .queryByTestId('entity-prev-next-nav')).toBeNull();
        // Current id outside the loaded window — arrows would point nowhere.
        expect(mount(['a1', 'a2'], 'not-in-list')
            .queryByTestId('entity-prev-next-nav')).toBeNull();
    });
});

describe('EntityPrevNextNav — arrow keys need alt, so the page still scrolls', () => {
    const ids = ['a1', 'a2', 'a3'];

    it('ignores a BARE ArrowUp/ArrowDown', () => {
        mount(ids, 'a2');
        fireEvent.keyDown(window, { key: 'ArrowUp' });
        fireEvent.keyDown(window, { key: 'ArrowDown' });
        expect(mockReplace).not.toHaveBeenCalled();
    });

    it('does not preventDefault a bare ArrowDown — that is the page scroll', () => {
        mount(ids, 'a2');
        const evt = new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            bubbles: true,
            cancelable: true,
        });
        window.dispatchEvent(evt);
        expect(evt.defaultPrevented).toBe(false);
    });

    it('navigates on alt+ArrowUp / alt+ArrowDown', () => {
        mount(ids, 'a2');

        fireEvent.keyDown(window, { key: 'ArrowUp', altKey: true });
        expect(mockReplace).toHaveBeenCalledWith(hrefFor('a1'));

        mockReplace.mockClear();
        fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
        expect(mockReplace).toHaveBeenCalledWith(hrefFor('a3'));
    });
});


// A probe that RENDERS whatever the shortcut registry currently holds. The
// keyboard `description` never reaches the nav's own markup, so it is
// invisible to any query over that — but a probe can put it somewhere
// queryable, which is how tests/rendered/keyboard-shortcut-hook.test.tsx
// introspects the registry. Rendering beats reassigning a module-scope
// binding from inside a component, which the React Compiler rule refuses.
function ShortcutProbe() {
    const list = useRegisteredShortcuts();
    return (
        <ul data-testid="shortcut-registry">
            {list.map((s) => (
                <li key={s.id}>{s.description ?? '(none)'}</li>
            ))}
        </ul>
    );
}

function mountWithProbe(labelSingular: string) {
    return render(
        <TooltipProvider delayDuration={0}>
            <KeyboardShortcutProvider>
                <EntityPrevNextNav
                    ids={['a1', 'a2', 'a3']}
                    currentId="a2"
                    hrefFor={hrefFor}
                    labelSingular={labelSingular}
                />
                <ShortcutProbe />
            </KeyboardShortcutProvider>
        </TooltipProvider>,
    );
}

describe('EntityPrevNextNav — labels come from the catalog', () => {
    const ids = ['a1', 'a2', 'a3'];

    // Scoped to the render's own container, not document.body: a test that
    // mounts several variants in one body would otherwise trip RTL's
    // "found multiple elements" error instead of comparing labels.
    const labels = (r: ReturnType<typeof mount>) => {
        const q = within(r.container);
        return {
            prev: q.getByTestId('entity-nav-prev').getAttribute('aria-label'),
            next: q.getByTestId('entity-nav-next').getAttribute('aria-label'),
        };
    };

    it('renders the English catalog phrases', () => {
        expect(labels(mount(ids, 'a2', 'item'))).toEqual({
            prev: 'Previous item',
            next: 'Next item',
        });
    });

    it('falls back to the generic record phrase for an unregistered entity', () => {
        expect(labels(mount(ids, 'a2', 'sprocket'))).toEqual({
            prev: 'Previous item',
            next: 'Next item',
        });
    });

    it('resolves to prose, never a raw catalog key', () => {
        for (const entity of ['item', 'sprocket']) {
            const { prev, next } = labels(mount(ids, 'a2', entity));
            for (const label of [prev, next]) {
                expect(label).not.toMatch(/recordStepper|previous\.|next\./);
            }
        }
    });

    it('uses the catalog phrases for the keyboard-shortcut descriptions too', () => {
        const r = mountWithProbe('item');
        const probe = within(r.container).getByTestId('shortcut-registry');
        const descriptions = Array.from(probe.querySelectorAll('li'))
            .map((li) => li.textContent)
            .sort();
        expect(descriptions).toEqual(['Next item', 'Previous item']);
    });
});

// The component gates on a local slug set instead of probing the catalog with
// `t.has`, so the set and the catalog have to be pinned to each other from
// BOTH directions — otherwise the gate silently drops an entity or an added
// catalog phrase never gets used.
describe('the stepper entity set and the catalog agree', () => {
    const en = enCatalog as unknown as Record<string, never>;
    const stepper = (m: Record<string, never>) =>
        (m as unknown as {
            ui: { recordStepper: Record<'previous' | 'next', Record<string, string>> };
        }).ui.recordStepper;

    it.each(['previous', 'next'] as const)(
        'every registered entity has a %s phrase',
        (direction) => {
            const missing: string[] = [];
            for (const slug of [...STEPPER_ENTITIES, 'item']) {
                if (!stepper(en)[direction][slug]) missing.push(`en.${direction}.${slug}`);
            }
            expect(missing).toEqual([]);
        },
    );

    it('every catalog phrase belongs to a registered entity', () => {
        const registered = new Set([...STEPPER_ENTITIES, 'item']);
        const orphans = ['previous', 'next'].flatMap((d) =>
            Object.keys(stepper(en)[d as 'previous']).filter((k) => !registered.has(k)),
        );
        expect(orphans).toEqual([]);
    });
});
