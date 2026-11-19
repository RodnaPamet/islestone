/**
 * Setup for the jsdom Jest project. Adapted from inflect-compliance's
 * tests/rendered/setup.ts (PROVENANCE.md), which the copied shared-UI tests
 * expect:
 *
 *   - `@testing-library/jest-dom` matchers (toBeInTheDocument, …);
 *   - `toHaveNoViolations` from jest-axe, for the axe-core assertions;
 *   - React 19's act environment flag, and DOM cleanup between tests;
 *   - matchMedia, IntersectionObserver, ResizeObserver, PointerEvent,
 *     scrollIntoView and pointer-capture shims, which jsdom lacks and the
 *     primitives (Radix, Vaul, cmdk, useMediaQuery) call;
 *   - the shared shims in ./jsdom-shims (window.scrollTo, a 30 s test timeout).
 */

import './jsdom-shims';
import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

// R32-task-64 — flag the jsdom project as a React-act environment.
//
// React 19's `act()` runtime reads `globalThis.IS_REACT_ACT_ENVIRONMENT`;
// when unset, every async state update that lands AFTER an
// `await act(...)` block resolves emits
// "The current testing environment is not configured to support act(...)".
// In multi-suite parallel jest runs this surfaces as a flake
// (`tests/rendered/org-drilldown-load-more.test.tsx`) — the warning
// is escalated to a failure when worker memory pressure makes the
// microtask queue drain land outside the act window.
//
// Setting the flag opts the jsdom project into act semantics for
// every rendered test, the same way React Testing Library
// configures `vitest` / `mocha` runners. No-op for non-React-19
// runtimes. Has to run BEFORE any test file imports React, which
// `setupFilesAfterEnv` (this file) guarantees.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;

afterEach(() => {
    cleanup();
});

// ─── jsdom polyfills ────────────────────────────────────────────

// matchMedia — useMediaQuery() relies on it.
if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: jest.fn(),
            removeListener: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
        }),
    });
}

// IntersectionObserver — Radix / Vaul occasionally probe this.
if (typeof window !== 'undefined' && !('IntersectionObserver' in window)) {
    class MockIntersectionObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
            return [];
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).IntersectionObserver = MockIntersectionObserver;
}

// ResizeObserver — Radix Popover measures triggers for positioning.
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
    class MockResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).ResizeObserver = MockResizeObserver;
}

// PointerEvent polyfill — Radix Dialog emits pointer events on focus
// trap enter/leave; jsdom doesn't ship PointerEvent natively.
if (typeof window !== 'undefined' && !('PointerEvent' in window)) {
    class MockPointerEvent extends MouseEvent {
        pointerId: number;
        pointerType: string;
        constructor(type: string, props: PointerEventInit = {}) {
            super(type, props);
            this.pointerId = props.pointerId ?? 0;
            this.pointerType = props.pointerType ?? 'mouse';
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).PointerEvent = MockPointerEvent;
}

// HTMLElement.scrollIntoView — cmdk uses it for keyboard nav; jsdom
// doesn't implement it.
if (
    typeof window !== 'undefined' &&
    !Element.prototype.scrollIntoView
) {
    Element.prototype.scrollIntoView = jest.fn();
}

// Element.hasPointerCapture — Radix relies on it.
if (
    typeof window !== 'undefined' &&
    !Element.prototype.hasPointerCapture
) {
    Element.prototype.hasPointerCapture = jest.fn(() => false);
}
if (
    typeof window !== 'undefined' &&
    !Element.prototype.setPointerCapture
) {
    Element.prototype.setPointerCapture = jest.fn();
}
if (
    typeof window !== 'undefined' &&
    !Element.prototype.releasePointerCapture
) {
    Element.prototype.releasePointerCapture = jest.fn();
}
