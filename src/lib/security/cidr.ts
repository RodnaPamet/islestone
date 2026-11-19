/**
 * Strict IP address and CIDR parsing, for the self-hosted egress allowlist
 * (`./egress-allowlist.ts`) and its env validation (`src/env.ts`).
 *
 * Written fresh for Islestone. inflect-compliance re-exports these functions
 * from its `@rodnapamet/scanent-contract` package, which Islestone does not
 * take (docs/porting/maps/1.5.md); the contract is the one
 * `tests/guards/egress-allowlist.test.ts` pins: hex byte expectations,
 * refusals, prefix bits and v4-mapped recognition.
 *
 * Strict on purpose. A lenient parser is how an address arrives disguised:
 * `010.1.1.1` is octal to some resolvers and decimal to others, and
 * `::ffff:169.254.169.254` is the metadata address written as IPv6. So an
 * octet with a leading zero, an out-of-range octet, a zone id, a second `::`
 * or a malformed group is refused rather than guessed at.
 *
 * No Node built-ins and no imports, so `src/env.ts` (which the edge runtime
 * loads) can use it.
 */

/** A parsed CIDR: the network address (4 or 16 bytes) and its prefix length. */
export interface Cidr {
    address: Uint8Array;
    prefixBits: number;
}

const DECIMAL_OCTET = /^(0|[1-9][0-9]{0,2})$/;
const HEX_GROUP = /^[0-9a-fA-F]{1,4}$/;

function parseV4(text: string): Uint8Array | null {
    const parts = text.split('.');
    if (parts.length !== 4) return null;
    const out = new Uint8Array(4);
    for (let i = 0; i < 4; i++) {
        const part = parts[i] ?? '';
        if (!DECIMAL_OCTET.test(part)) return null;
        const value = Number(part);
        if (value > 255) return null;
        out[i] = value;
    }
    return out;
}

function parseGroups(text: string): number[] | null {
    if (text === '') return [];
    const groups: number[] = [];
    for (const group of text.split(':')) {
        if (!HEX_GROUP.test(group)) return null;
        groups.push(parseInt(group, 16));
    }
    return groups;
}

function parseV6(text: string): Uint8Array | null {
    if (text.includes('%')) return null; // zone ids are not addresses we route to
    let body = text;

    // An embedded IPv4 in the last 32 bits (`::ffff:10.0.0.1`) is rewritten
    // as the two hex groups it stands for, then parsed like any other group.
    const lastColon = body.lastIndexOf(':');
    if (lastColon !== -1 && body.slice(lastColon + 1).includes('.')) {
        const v4 = parseV4(body.slice(lastColon + 1));
        if (v4 === null) return null;
        const hi = (((v4[0] ?? 0) << 8) | (v4[1] ?? 0)).toString(16);
        const lo = (((v4[2] ?? 0) << 8) | (v4[3] ?? 0)).toString(16);
        body = `${body.slice(0, lastColon + 1)}${hi}:${lo}`;
    }

    const halves = body.split('::');
    if (halves.length > 2) return null;

    let groups: number[];
    if (halves.length === 2) {
        const head = parseGroups(halves[0] ?? '');
        const rest = parseGroups(halves[1] ?? '');
        if (head === null || rest === null) return null;
        const missing = 8 - head.length - rest.length;
        if (missing < 1) return null;
        groups = [...head, ...new Array<number>(missing).fill(0), ...rest];
    } else {
        const all = parseGroups(body);
        if (all === null) return null;
        groups = all;
    }
    if (groups.length !== 8) return null;

    const out = new Uint8Array(16);
    groups.forEach((g, i) => {
        out[i * 2] = g >> 8;
        out[i * 2 + 1] = g & 0xff;
    });
    return out;
}

/**
 * Parse an IPv4 (4 bytes) or IPv6 (16 bytes) address. `null` for anything
 * that is not exactly one address, including a CIDR.
 */
export function parseAddress(text: string): Uint8Array | null {
    if (typeof text !== 'string' || text.length === 0 || text.includes('/')) return null;
    return text.includes(':') ? parseV6(text) : parseV4(text);
}

/** Parse `address/prefixBits`. `null` when either half is malformed or the prefix is out of range. */
export function parseCidr(text: string): Cidr | null {
    if (typeof text !== 'string') return null;
    const slash = text.indexOf('/');
    if (slash === -1 || slash !== text.lastIndexOf('/')) return null;
    const address = parseAddress(text.slice(0, slash));
    const bitsText = text.slice(slash + 1);
    if (address === null || !/^(0|[1-9][0-9]{0,2})$/.test(bitsText)) return null;
    const prefixBits = Number(bitsText);
    if (prefixBits > address.length * 8) return null;
    return { address, prefixBits };
}

/**
 * True when `addr` lies inside `cidr`. Addresses of a different family never
 * match: a v4-mapped v6 address is checked against v4 ranges by the caller,
 * explicitly, through `isV4Mapped`.
 */
export function inCidr(addr: Uint8Array, cidr: Cidr): boolean {
    if (addr.length !== cidr.address.length) return false;
    let bits = cidr.prefixBits;
    for (let i = 0; i < addr.length && bits > 0; i++) {
        const take = Math.min(8, bits);
        const mask = (0xff << (8 - take)) & 0xff;
        if (((addr[i] ?? 0) & mask) !== ((cidr.address[i] ?? 0) & mask)) return false;
        bits -= take;
    }
    return true;
}

/** True for a 16-byte `::ffff:a.b.c.d` address. A 4-byte address is never v4-mapped. */
export function isV4Mapped(addr: Uint8Array): boolean {
    if (addr.length !== 16) return false;
    for (let i = 0; i < 10; i++) if (addr[i] !== 0) return false;
    return addr[10] === 0xff && addr[11] === 0xff;
}
