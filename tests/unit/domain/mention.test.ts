/**
 * The mention grammar (sub-phase 2.7d; owner decisions 127 to 131): parsing,
 * the edit's change, display segments, the picker's query and insertion, and
 * the token surviving the plain-text sanitiser every comment and description
 * goes through. Property-tested where a property says more than an example.
 */
import fc from 'fast-check';

import {
    MAX_MENTIONS_PER_TEXT,
    insertMention,
    mentionQueryAt,
    mentionTarget,
    mentionToken,
    parseMentionIds,
    planMentionChange,
    segmentSource,
    segmentText,
} from '@/app-layer/domain/mention';
import { sanitizePlainText } from '@/lib/security/sanitize';

const userId = fc.stringMatching(/^[a-z0-9]{1,24}$/);
/** Text with no `<`, `>` or `@`: it can hold no token. */
const plain = fc.string({ maxLength: 40 }).map((s) => s.replace(/[<>@]/g, ' '));

describe('parseMentionIds', () => {
    it('finds each token once, in order of first appearance', () => {
        expect(parseMentionIds('Hi <@ada> and <@bob>, <@ada> again')).toEqual(['ada', 'bob']);
    });

    it('ignores what is not a person: an agent prefix, spaces, an empty token, markup', () => {
        expect(parseMentionIds('<@agent:reviewer> <@ a> <@> <b>x</b> <@a b>')).toEqual([]);
        expect(mentionTarget('agent:x')).toBeNull();
    });

    it('caps how many people one text names', () => {
        const text = Array.from({ length: MAX_MENTIONS_PER_TEXT + 5 }, (_, i) => `<@u${i}>`).join(' ');
        expect(parseMentionIds(text)).toHaveLength(MAX_MENTIONS_PER_TEXT);
    });

    it('property: every token put into plain text is found, and nothing else', () => {
        fc.assert(
            fc.property(fc.array(fc.tuple(plain, userId), { maxLength: 8 }), plain, (parts, tail) => {
                const text = parts.map(([p, id]) => `${p} ${mentionToken(id)}`).join('') + tail;
                const expected = [...new Set(parts.map(([, id]) => id))].slice(0, MAX_MENTIONS_PER_TEXT);
                expect(parseMentionIds(text)).toEqual(expected);
            }),
        );
    });

    it('the token survives sanitizePlainText as typed', () => {
        fc.assert(
            fc.property(plain, userId, plain, (a, id, b) => {
                const text = `${a.trim()} ${mentionToken(id)} ${b.trim()}`.trim();
                expect(parseMentionIds(sanitizePlainText(text))).toEqual([id]);
            }),
        );
        expect(sanitizePlainText('Look <@cm123abc>, & <b>now</b>')).toBe('Look <@cm123abc>, & now');
    });
});

describe('planMentionChange', () => {
    it('adds only allowed people not recorded before, and removes rows whose token went', () => {
        expect(planMentionChange(['ada', 'cy'], ['ada', 'bob', 'dan'], new Set(['bob']))).toEqual({ add: ['bob'], remove: ['cy'] });
    });

    it('property: an edit that changes nothing adds nothing and removes nothing', () => {
        fc.assert(
            fc.property(fc.uniqueArray(userId, { maxLength: 10 }), (ids) => {
                expect(planMentionChange(ids, ids, new Set(ids))).toEqual({ add: [], remove: [] });
            }),
        );
    });

    it('property: added people are named, allowed and new; removed ones are recorded and no longer named', () => {
        fc.assert(
            fc.property(fc.uniqueArray(userId, { maxLength: 10 }), fc.uniqueArray(userId, { maxLength: 10 }), fc.uniqueArray(userId, { maxLength: 10 }), (recorded, named, allowed) => {
                const { add, remove } = planMentionChange(recorded, named, new Set(allowed));
                for (const id of add) {
                    expect(named).toContain(id);
                    expect(allowed).toContain(id);
                    expect(recorded).not.toContain(id);
                }
                for (const id of remove) {
                    expect(recorded).toContain(id);
                    expect(named).not.toContain(id);
                }
            }),
        );
    });
});

describe('segmentText', () => {
    const opts = { isMentioned: (id: string) => id === 'ada', isKnownPrefix: (p: string) => p === 'ISL' };

    it('chips only recorded people; any other token stays text (the authority rule)', () => {
        expect(segmentText('Hi <@ada> and <@eve>', opts)).toEqual([
            { kind: 'text', text: 'Hi ' },
            { kind: 'mention', userId: 'ada' },
            { kind: 'text', text: ' and <@eve>' },
        ]);
    });

    it('links keys with a known prefix and leaves the rest as text', () => {
        expect(segmentText('See ISL-12, UTF-8, xISL-3, isl-4 and ISL-5.', opts)).toEqual([
            { kind: 'text', text: 'See ' },
            { kind: 'key', key: 'ISL-12' },
            { kind: 'text', text: ', UTF-8, xISL-3, isl-4 and ' },
            { kind: 'key', key: 'ISL-5' },
            { kind: 'text', text: '.' },
        ]);
    });

    it('without a prefix check, no key is linked', () => {
        expect(segmentText('ISL-1', { isMentioned: () => false })).toEqual([{ kind: 'text', text: 'ISL-1' }]);
    });

    it('property: joining the segments gives the text back', () => {
        const piece = fc.oneof(plain, userId.map((id) => `<@${id}>`), fc.constantFrom('ISL-1', 'ISL-99', 'AB-2', '<@agent:x>', '<@>'));
        fc.assert(
            fc.property(fc.array(piece, { maxLength: 12 }), fc.boolean(), (pieces, all) => {
                const text = pieces.join(' ');
                const segments = segmentText(text, { isMentioned: () => all, isKnownPrefix: () => all });
                expect(segments.map(segmentSource).join('')).toBe(text);
            }),
        );
    });
});

describe('the picker', () => {
    it('opens on an @ at the start or after whitespace, with what follows', () => {
        expect(mentionQueryAt('@', 1)).toEqual({ start: 0, query: '' });
        expect(mentionQueryAt('Hi @ad', 6)).toEqual({ start: 3, query: 'ad' });
        expect(mentionQueryAt('mail me@ex', 10)).toBeNull();
        expect(mentionQueryAt('Hi @ada lovelace', 16)).toBeNull();
    });

    it('puts the token in place of the @query, with a space after it', () => {
        const at = mentionQueryAt('Hi @ad, thanks', 6)!;
        expect(insertMention('Hi @ad, thanks', at, 'ada')).toEqual({ text: 'Hi <@ada> , thanks', caret: 10 });
        expect(insertMention('@', { start: 0, query: '' }, 'bob')).toEqual({ text: '<@bob> ', caret: 7 });
        expect(() => mentionToken('agent:x')).toThrow();
    });
});
