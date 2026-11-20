/**
 * Mentions in plain text (sub-phase 2.7d; docs/porting/maps/2.7.md, part 5;
 * owner decisions 127 to 131).
 *
 * Comments and descriptions stay plain text (decision 127): a mention is the
 * token `<@userId>`, which the `@` picker inserts and the renderer shows as a
 * chip with the person's current name. The token survives
 * `sanitizePlainText` as typed (`tests/unit/domain/mention.test.ts` holds it).
 *
 * The text is never the authority. A token names somebody only when its
 * source (the comment, or the item's description) has a `Mention` row for
 * that person, written by a person's own edit after the server checked the
 * person may be mentioned (`recordMentionsInTx`). So the renderer asks
 * `isMentioned` for each token, and any other `<@…>` renders as the literal
 * text it is: a token an intake requester typed, a template or a repeat
 * copied, or somebody pasted, names nobody and notifies nobody (decision 129).
 *
 * A work-item key in the text (`ISL-123`) is found here too, for the renderer
 * to link at display time; nothing is stored for it (decision 131).
 *
 * Pure and client-safe: the usecases and the renderer read the same grammar.
 * Written fresh for Islestone.
 */
import { parseKey } from './work-item-key';

/** At most this many people are mentioned by one text; later tokens are text. */
export const MAX_MENTIONS_PER_TEXT = 20;

/** What a user id in a token may be: a cuid, or a test fixture's id. */
const MENTION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * One scan for both: a `<@…>` token (group 1), or an upper-case key not
 * inside a longer word (groups 2 and 3).
 */
const SCAN = /<@([^<>\s]{1,80})>|(?<![A-Za-z0-9-])([A-Z][A-Z0-9]{1,9})-(\d{1,10})(?![A-Za-z0-9])/g;

/** The token for a person. */
export function mentionToken(userId: string): string {
    if (!MENTION_ID.test(userId)) throw new Error('mentionToken: not a user id');
    return `<@${userId}>`;
}

/**
 * The person a token's inner text names, or `null`. A prefixed target
 * (`<@agent:…>`, 6.3's invocation by mention) is not a person and is refused
 * until 6.3 amends the grammar.
 */
export function mentionTarget(inner: string): string | null {
    if (inner.includes(':')) return null;
    return MENTION_ID.test(inner) ? inner : null;
}

/**
 * The people a text names, in order of first appearance, each once, at most
 * {@link MAX_MENTIONS_PER_TEXT}. The caller still decides who may be
 * mentioned; this is only the grammar.
 */
export function parseMentionIds(text: string | null | undefined): string[] {
    if (!text) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const m of text.matchAll(SCAN)) {
        if (m[1] === undefined) continue;
        const id = mentionTarget(m[1]);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
        if (out.length >= MAX_MENTIONS_PER_TEXT) break;
    }
    return out;
}

export interface MentionChange {
    /** People to record: allowed, and not recorded for this source before. */
    add: string[];
    /** Recorded people whose token is gone from the text. */
    remove: string[];
}

/**
 * What an edit changes for one source: `recorded` are its rows, `named` the
 * text's tokens (`parseMentionIds`), `allowed` the named people the server
 * admitted (active members who can see the project). An edit records only
 * people not recorded before, so only they are notified; a token removed
 * removes its row and notifies nobody; a recorded person whose token stays is
 * kept as is.
 */
export function planMentionChange(recorded: Iterable<string>, named: readonly string[], allowed: ReadonlySet<string>): MentionChange {
    const before = new Set(recorded);
    const namedSet = new Set(named);
    return {
        add: named.filter((id) => allowed.has(id) && !before.has(id)),
        remove: [...before].filter((id) => !namedSet.has(id)),
    };
}

export type TextSegment =
    | { kind: 'text'; text: string }
    | { kind: 'mention'; userId: string }
    | { kind: 'key'; key: string };

export interface SegmentOptions {
    /** Does the text's source have a `Mention` row for this person? */
    isMentioned: (userId: string) => boolean;
    /** Is this a prefix of a project the reader knows? Unknown prefixes stay text. */
    isKnownPrefix?: (prefix: string) => boolean;
}

/**
 * Split a text for display: plain text, recorded mentions (chips) and keys
 * (links). A token without a row, and a key whose prefix the reader does not
 * know, stay text exactly as written. Joining every segment's source gives
 * the text back (`segmentSource`).
 */
export function segmentText(text: string, opts: SegmentOptions): TextSegment[] {
    const out: TextSegment[] = [];
    let last = 0;
    let buffer = '';
    const flush = () => {
        if (buffer) out.push({ kind: 'text', text: buffer });
        buffer = '';
    };
    for (const m of text.matchAll(SCAN)) {
        const at = m.index ?? 0;
        buffer += text.slice(last, at);
        last = at + m[0].length;
        if (m[1] !== undefined) {
            const id = mentionTarget(m[1]);
            if (id && opts.isMentioned(id)) {
                flush();
                out.push({ kind: 'mention', userId: id });
                continue;
            }
        } else {
            const parsed = parseKey(`${m[2]}-${m[3]}`);
            if (parsed && (opts.isKnownPrefix?.(parsed.prefix) ?? false)) {
                flush();
                out.push({ kind: 'key', key: m[0] });
                continue;
            }
        }
        buffer += m[0];
    }
    buffer += text.slice(last);
    flush();
    return out;
}

/** The text a segment stands for (a chip's token, a link's key). */
export function segmentSource(s: TextSegment): string {
    if (s.kind === 'text') return s.text;
    if (s.kind === 'mention') return `<@${s.userId}>`;
    return s.key;
}

/**
 * The token being typed at the caret, for the `@` picker: an `@` at the start
 * or after whitespace, then up to 32 characters with no whitespace or `<>@`.
 * Returns where the `@` is and what follows it, or `null`.
 */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
    const before = text.slice(0, caret);
    const m = /(^|\s)@([^\s<>@]{0,32})$/.exec(before);
    if (!m) return null;
    return { start: caret - m[2]!.length - 1, query: m[2]! };
}

/**
 * Put a person's token in place of the `@query` the picker was opened on,
 * followed by a space. Returns the new text and the caret after the space.
 */
export function insertMention(text: string, at: { start: number; query: string }, userId: string): { text: string; caret: number } {
    const token = `${mentionToken(userId)} `;
    const end = at.start + 1 + at.query.length;
    const rest = text.slice(end).replace(/^ /, '');
    return { text: text.slice(0, at.start) + token + rest, caret: at.start + token.length };
}
