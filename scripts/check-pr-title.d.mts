// Types for scripts/check-pr-title.mjs, so TypeScript tests can import it
// (tsconfig has allowJs off). This file declares the module's exports and
// nothing else; the behaviour lives in the .mjs and its tests.

export declare const TYPES: readonly string[];
export declare const MAX_LENGTH: number;
export declare const PR_TITLE_PATTERN: RegExp;
export type PrTitleResult =
    | { ok: true; type: string; breaking: boolean }
    | { ok: false; reason: string };
export declare function checkPrTitle(title: string): PrTitleResult;
