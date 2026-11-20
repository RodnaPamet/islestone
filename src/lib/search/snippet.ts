/**
 * The snippet a description or comment hit shows (sub-phase 2.7f;
 * docs/search.md): a window of at most `SNIPPET_LENGTH` characters of the
 * matched text, around the first place a word of the query starts, with
 * mention tokens taken out (a token renders as a chip only where it is
 * recorded, which a snippet cannot know) and whitespace folded. The text is
 * already sanitised on write; the palette renders the snippet as text.
 *
 * Pure and client-safe. Written fresh for Islestone.
 */
import { SNIPPET_LENGTH } from './types';

const MENTION_TOKEN = /<@[^<>\s]{1,80}>/g;

/** How much of a word's start finds it again in an inflected form ("задача" in "задачата"). */
const STEM_PROBE = 4;

/** How far before the first match the window starts. */
const LEAD = 30;

/** The query's words, lower-cased, each at most {@link STEM_PROBE} letters, longest first. */
function probes(query: string): string[] {
    const words = query
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 2 && w !== 'or');
    return [...new Set(words.map((w) => w.slice(0, STEM_PROBE)))].sort((a, b) => b.length - a.length);
}

export function buildSnippet(text: string, query: string): string {
    const flat = text.replace(MENTION_TOKEN, ' ').replace(/\s+/g, ' ').trim();
    if (flat.length <= SNIPPET_LENGTH) return flat;
    const lower = flat.toLocaleLowerCase();
    let at = -1;
    for (const probe of probes(query)) {
        const i = lower.indexOf(probe);
        if (i !== -1 && (at === -1 || i < at)) at = i;
    }
    const start = at <= LEAD ? 0 : Math.min(at - LEAD, flat.length - SNIPPET_LENGTH);
    const end = Math.min(flat.length, start + SNIPPET_LENGTH);
    return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}
