/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS manual mock (Jest loads it through require); copied from inflect-compliance (PROVENANCE.md), whose lint config allows it */
/**
 * Global manual mock for `next-intl` (client entrypoint).
 *
 * `next-intl` ships ESM-only; Jest's node_modules transform does not parse it,
 * so ANY test that renders a component importing `next-intl` fails to run with
 * `SyntaxError: Unexpected token 'export'`. This CJS mock replaces the module
 * across every Jest project, so components that call `useTranslations()` render
 * cleanly in jsdom.
 *
 * Keys resolve against the REAL English catalog (`messages/en.json`) with
 * `{param}` interpolation, so assertions on visible English text keep holding
 * without per-test message wiring. A test that needs bespoke translation
 * behaviour can still declare its own `jest.mock('next-intl', …)` — a local
 * factory overrides this manual mock.
 *
 * Auto-applied because it sits in `<rootDir>/__mocks__/` adjacent to
 * `node_modules` (Jest auto-mocks node_modules packages from that folder with
 * no `jest.mock()` call required).
 */
const React = require('react');
const en = require('../messages/en.json');

function lookup(namespace, key) {
    const path = namespace ? `${namespace}.${key}` : key;
    return path
        .split('.')
        .reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), en);
}

/**
 * ICU `{name, plural, =0 {…} one {…} other {…}}` as next-intl formats it in
 * English: an exact `=n` branch first, then `one` for 1, else `other`; `#`
 * is the number through `Intl.NumberFormat`. Nested arguments are left to
 * `interpolate`. Without it a plural message rendered its raw source.
 */
function formatPlurals(str, params) {
    let out = '';
    let i = 0;
    while (i < str.length) {
        const head = /^\{(\w+),\s*plural,/.exec(str.slice(i));
        if (!head || !Object.prototype.hasOwnProperty.call(params, head[1])) {
            out += str[i];
            i += 1;
            continue;
        }
        // The argument's closing brace, matching nested braces.
        let depth = 0;
        let end = i;
        for (; end < str.length; end++) {
            if (str[end] === '{') depth++;
            else if (str[end] === '}' && --depth === 0) break;
        }
        const body = str.slice(i + head[0].length, end);
        const branches = {};
        const re = /\s*(=\d+|\w+)\s*\{/g;
        let m;
        while ((m = re.exec(body))) {
            let d = 1;
            let j = re.lastIndex;
            for (; j < body.length && d > 0; j++) {
                if (body[j] === '{') d++;
                else if (body[j] === '}') d--;
            }
            branches[m[1]] = body.slice(re.lastIndex, j - 1);
            re.lastIndex = j;
        }
        const n = Number(params[head[1]]);
        const chosen = branches[`=${n}`] ?? (n === 1 ? branches.one : undefined) ?? branches.other ?? '';
        out += formatPlurals(chosen, params).replace(/#/g, new Intl.NumberFormat('en').format(n));
        i = end + 1;
    }
    return out;
}

function interpolate(str, params) {
    if (typeof str !== 'string' || !params) return str;
    return formatPlurals(str, params).replace(/\{(\w+)\}/g, (m, name) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m,
    );
}

/** Strip HTML tags to a fixed point (safe against crafted nesting like `<<b>x>`). */
function stripTags(value) {
    let s = String(value);
    let prev;
    do {
        prev = s;
        s = s.replace(/<[^<>]*>/g, '');
    } while (s !== prev);
    return s;
}

function makeT(namespace) {
    const t = (key, params) => {
        const val = lookup(namespace, key);
        return interpolate(typeof val === 'string' ? val : key, params);
    };
    // `.rich` resolves the string and strips tag placeholders — structural
    // tests only need the text content, not the wrapped elements.
    t.rich = (key) => {
        const val = lookup(namespace, key);
        return stripTags(typeof val === 'string' ? val : key);
    };
    t.markup = (key, params) => interpolate(
        typeof lookup(namespace, key) === 'string' ? lookup(namespace, key) : key,
        params,
    );
    t.raw = (key) => lookup(namespace, key);
    t.has = (key) => lookup(namespace, key) !== undefined;
    return t;
}

const useTranslations = (namespace) => makeT(namespace);
const useLocale = () => 'en';
const useMessages = () => en;
const useNow = () => new Date(0);
const useTimeZone = () => 'UTC';
// `relativeTime` as next-intl formats it: the largest whole unit between
// `date` and `now`, through Intl.RelativeTimeFormat in English, so a test
// reads "5 minutes ago" rather than a stringified Date.
const RELATIVE_UNITS = [
    ['year', 365 * 24 * 3600],
    ['month', 30 * 24 * 3600],
    ['week', 7 * 24 * 3600],
    ['day', 24 * 3600],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
];
const relativeTime = (date, now) => {
    const then = new Date(date).getTime();
    const base = now instanceof Date || typeof now === 'number' ? new Date(now).getTime() : Date.now();
    const seconds = Math.round((then - base) / 1000);
    const [unit, size] = RELATIVE_UNITS.find(([, sz]) => Math.abs(seconds) >= sz) || ['second', 1];
    return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(Math.trunc(seconds / size), unit);
};
const useFormatter = () => ({
    dateTime: (d) => String(d),
    number: (n) => String(n),
    relativeTime,
    list: (l) => Array.from(l).join(', '),
});
const NextIntlClientProvider = ({ children }) =>
    React.createElement(React.Fragment, null, children);
const IntlProvider = NextIntlClientProvider;

module.exports = {
    useTranslations,
    useLocale,
    useMessages,
    useNow,
    useTimeZone,
    useFormatter,
    NextIntlClientProvider,
    IntlProvider,
};
