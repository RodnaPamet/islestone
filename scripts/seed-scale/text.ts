/**
 * Generated text for the scale seed (Hardening H2a): titles, descriptions and
 * comment bodies in Bulgarian, English or both, from the committed word list.
 * Pure and deterministic given the stream.
 */
import type { Rng } from './random';
import { BULGARIAN_JOINERS, BULGARIAN_WORDS, ENGLISH_JOINERS, ENGLISH_WORDS } from './words';

type Language = 'bg' | 'en' | 'mixed';

function language(rng: Rng): Language {
    return rng.weighted<Language>([
        ['bg', 0.45],
        ['en', 0.45],
        ['mixed', 0.1],
    ]);
}

function word(rng: Rng, lang: Language): string {
    const bg = lang === 'bg' || (lang === 'mixed' && rng.chance(0.5));
    return rng.pick(bg ? BULGARIAN_WORDS : ENGLISH_WORDS);
}

function joiner(rng: Rng, lang: Language): string {
    return rng.pick(lang === 'en' ? ENGLISH_JOINERS : BULGARIAN_JOINERS);
}

function phrase(rng: Rng, lang: Language, min: number, max: number): string {
    const n = rng.int(min, max);
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(i > 0 && i < n - 1 && rng.chance(0.2) ? joiner(rng, lang) : word(rng, lang));
    return out.join(' ');
}

function capitalise(s: string): string {
    return s.length === 0 ? s : s[0]!.toLocaleUpperCase('bg') + s.slice(1);
}

function sentence(rng: Rng, lang: Language): string {
    return `${capitalise(phrase(rng, lang, 6, 14))}.`;
}

/** A work item's title: four to nine words. */
export function title(rng: Rng): string {
    return capitalise(phrase(rng, language(rng), 4, 9));
}

/** A description: two to five sentences. */
export function description(rng: Rng): string {
    const lang = language(rng);
    const n = rng.int(2, 5);
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(sentence(rng, lang));
    return out.join(' ');
}

/** A comment body: one to three sentences. */
export function commentBody(rng: Rng): string {
    const lang = language(rng);
    const n = rng.int(1, 3);
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(sentence(rng, lang));
    return out.join(' ');
}

/** A short text value for a TEXT custom field (at most 500 characters by CHECK). */
export function shortText(rng: Rng): string {
    return capitalise(phrase(rng, language(rng), 2, 4));
}
