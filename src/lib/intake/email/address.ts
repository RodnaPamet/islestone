/**
 * Intake email addresses (sub-phase 2.6c; docs/porting/maps/2.6.md "Address
 * format"). A project's address is `<token>@<domain>`; an emailed request's
 * reply address is `<token>+r<replyToken>@<domain>`. Tokens use an
 * unambiguous lower-case alphabet (no 0/o, 1/l/i) so an address read aloud or
 * retyped still works, and carry no workspace slug or project key, so an
 * address cannot be guessed from a URL. Pure; written fresh for Islestone.
 */
import { randomInt } from 'node:crypto';

export const TOKEN_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const ADDRESS_TOKEN_LENGTH = 12;
export const REPLY_TOKEN_LENGTH = 16;

function mint(length: number): string {
    let out = '';
    for (let i = 0; i < length; i++) out += TOKEN_ALPHABET[randomInt(TOKEN_ALPHABET.length)];
    return out;
}

export const mintAddressToken = () => mint(ADDRESS_TOKEN_LENGTH);
export const mintReplyToken = () => mint(REPLY_TOKEN_LENGTH);

const TOKEN = `[${TOKEN_ALPHABET}]`;
const LOCAL = new RegExp(`^(${TOKEN}{${ADDRESS_TOKEN_LENGTH}})(?:\\+r(${TOKEN}{${REPLY_TOKEN_LENGTH}}))?$`);

export interface IntakeAddress {
    token: string;
    replyToken: string | null;
}

/**
 * ASCII letters lower-cased, every other character kept as it is. Full
 * Unicode lower-casing folds look-alikes into ASCII (`K`, the Kelvin sign,
 * becomes `k`; `İ` becomes `i̇`), so an address spelt with one would have
 * matched a real token or domain (found by Hardening H2f's fuzzing).
 */
export function asciiLower(value: string): string {
    return value.replace(/[A-Z]+/g, (c) => c.toLowerCase());
}

/**
 * Whether `value` holds a character outside ASCII that changes case into
 * ASCII (`K`, the Kelvin sign, lower-cases to `k`; `ſ` upper-cases to `S`).
 * The workspace's address lookups fold case fully (`hashForLookup`), so such
 * an address would be taken for the ASCII one it imitates (H2f).
 */
export function hasAsciiLookalike(value: string): boolean {
    for (const ch of value) {
        if (ch.charCodeAt(0) < 0x80) continue;
        if (/[\x00-\x7f]/.test(ch.toLowerCase()) || /[\x00-\x7f]/.test(ch.toUpperCase())) return true;
    }
    return false;
}

/** The intake address `address` names on `domain`, or null. ASCII case-insensitive; anything not printable ASCII is no intake address. */
export function parseIntakeAddress(address: string, domain: string): IntakeAddress | null {
    const trimmed = address.trim();
    if (!/^[\x21-\x7e]+$/.test(trimmed)) return null;
    const lower = asciiLower(trimmed);
    const at = lower.lastIndexOf('@');
    if (at < 1) return null;
    if (lower.slice(at + 1) !== asciiLower(domain)) return null;
    const m = LOCAL.exec(lower.slice(0, at));
    return m ? { token: m[1]!, replyToken: m[2] ?? null } : null;
}

export function intakeAddress(token: string, domain: string): string {
    return `${token}@${domain}`;
}

export function replyAddress(token: string, replyToken: string, domain: string): string {
    return `${token}+r${replyToken}@${domain}`;
}

/** Whether a run of address characters holds an `@` with at least one character either side. */
function hasInnerAt(run: string): boolean {
    const at = run.indexOf('@', 1);
    return at > 0 && at < run.length - 1;
}

const ANGLE_RUN = /[^<>\s]*/y;

/**
 * The first `<local@domain>` in `value` (the run between the brackets free of
 * `<`, `>` and whitespace), in one pass. The regular expression this replaces
 * (`/<([^<>\s]+@[^<>\s]+)>/`) backtracked over every `@` of an unclosed
 * bracket, and its bare twin over every start of a long run without an `@`:
 * quadratic, seconds for a 40 KB `From` (found by Hardening H2f's fuzzing).
 * Same answers, linear time.
 */
function angleAddress(value: string): string | undefined {
    for (let lt = value.indexOf('<'); lt >= 0; lt = value.indexOf('<', lt + 1)) {
        ANGLE_RUN.lastIndex = lt + 1;
        const run = ANGLE_RUN.exec(value)![0];
        if (value[lt + 1 + run.length] === '>' && hasInnerAt(run)) return run;
    }
    return undefined;
}

/** The first run of address characters with an inner `@` (what `/([^\s<>"(),;:]+@[^\s<>"(),;:]+)/` matched), in one pass. */
function bareAddress(value: string): string | undefined {
    return value.split(/[\s<>"(),;:]+/).find(hasInnerAt);
}

/**
 * The addresses in a header value (`"Ada" <ada@x.io>, bob@y.io`), with ASCII
 * letters lower-cased and without display names. An address is looked for
 * only outside quoted strings and comments, as RFC 5322 reads them: a display
 * name or a comment that holds `<victim@example.com>` is not the address
 * (found by Hardening H2f's fuzzing). Quoted strings and comments may hold
 * commas; one left open reads to the end as ordinary text.
 */
export function addressesIn(value: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let quoted = false;
    /** Where the open quoted string or comment began. */
    let openedAt = -1;
    let pieces: string[] = [];
    let from = 0;
    const flush = () => {
        const current = pieces.join('');
        pieces = [];
        const address = angleAddress(current) ?? bareAddress(current);
        if (address) out.push(asciiLower(address));
    };
    // By index over code units: every character that steers the walk is ASCII,
    // so this reads as a walk over code points does, and slices instead of
    // building each address a character at a time (a 10 MB header; H2f).
    for (let i = 0; i < value.length; i++) {
        const ch = value.charCodeAt(i);
        if (quoted) {
            if (ch === 0x5c) i++; // a quoted pair
            else if (ch === 0x22) {
                quoted = false;
                from = i + 1;
            }
        } else if (depth > 0) {
            if (ch === 0x5c) i++;
            else if (ch === 0x28) depth++;
            else if (ch === 0x29 && --depth === 0) from = i + 1;
        } else if (ch === 0x22 || ch === 0x28) {
            // Quoted strings and comments read as a space.
            pieces.push(value.slice(from, i), ' ');
            openedAt = i;
            if (ch === 0x22) quoted = true;
            else depth = 1;
        } else if (ch === 0x2c) {
            pieces.push(value.slice(from, i));
            flush();
            from = i + 1;
        }
    }
    // A quoted string or comment left open reads to the end as ordinary text.
    pieces.push(quoted || depth > 0 ? value.slice(openedAt + 1) : value.slice(from));
    flush();
    return out;
}

/** The display name and address of a single mailbox (`From`). */
export function mailboxOf(value: string): { name: string | null; address: string | null } {
    const address = addressesIn(value)[0] ?? null;
    const lt = value.indexOf('<');
    let name = lt > 0 ? value.slice(0, lt).trim() : '';
    name = name.replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1').trim();
    return { name: name.length > 0 ? name : null, address };
}

export function domainOf(address: string | null): string | null {
    if (!address) return null;
    const at = address.lastIndexOf('@');
    return at > 0 ? asciiLower(address.slice(at + 1)) : null;
}
