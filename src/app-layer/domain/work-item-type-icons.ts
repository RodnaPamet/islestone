/**
 * The icon keys a work item type may carry (ADR 0002 §1). A type stores a
 * key, never a URL or markup; sub-phase 2.3 maps each key to a component of
 * the shared icon set. Client-safe.
 */
export const WORK_ITEM_TYPE_ICONS = [
    'feature',
    'bug',
    'chore',
    'spark',
    'flag',
    'book',
    'bolt',
    'shield',
    'check',
    'circle',
] as const;

export type WorkItemTypeIcon = (typeof WORK_ITEM_TYPE_ICONS)[number];

/** A colour: a token name (`brand-500`) or `#RRGGBB`. */
export const COLOR_PATTERN = /^(#[0-9a-fA-F]{6}|[a-z][a-z0-9-]{0,39})$/;
