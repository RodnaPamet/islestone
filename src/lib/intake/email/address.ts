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

/** The intake address `address` names on `domain`, or null. Case-insensitive. */
export function parseIntakeAddress(address: string, domain: string): IntakeAddress | null {
    const at = address.trim().toLowerCase().lastIndexOf('@');
    if (at < 1) return null;
    const local = address.trim().toLowerCase().slice(0, at);
    const host = address.trim().toLowerCase().slice(at + 1);
    if (host !== domain.toLowerCase()) return null;
    const m = LOCAL.exec(local);
    return m ? { token: m[1]!, replyToken: m[2] ?? null } : null;
}

export function intakeAddress(token: string, domain: string): string {
    return `${token}@${domain}`;
}

export function replyAddress(token: string, replyToken: string, domain: string): string {
    return `${token}+r${replyToken}@${domain}`;
}

/**
 * The addresses in a header value (`"Ada" <ada@x.io>, bob@y.io`), lower-cased
 * and without display names. Quoted display names may hold commas.
 */
export function addressesIn(value: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let quoted = false;
    let current = '';
    const flush = () => {
        const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(current);
        const bare = angle ? angle[1] : /([^\s<>"(),;:]+@[^\s<>"(),;:]+)/.exec(current)?.[1];
        if (bare) out.push(bare.toLowerCase());
        current = '';
    };
    for (const ch of value) {
        if (ch === '"') quoted = !quoted;
        else if (!quoted && ch === '(') depth++;
        else if (!quoted && ch === ')') depth = Math.max(0, depth - 1);
        if (ch === ',' && !quoted && depth === 0) flush();
        else current += ch;
    }
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
    return at > 0 ? address.slice(at + 1).toLowerCase() : null;
}
