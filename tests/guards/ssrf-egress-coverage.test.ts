/**
 * SSRF egress coverage ratchet.
 *
 * The webhook-safety guard (private/loopback/link-local + cloud-metadata
 * block, https-only, DNS-rebinding re-check, IP-pin) must sit in front of
 * EVERY tenant-controlled outbound fetch. In inflect-compliance it once
 * guarded only the automation webhook action, and the tenant-controlled
 * audit-stream URL fetched directly: a cloud-metadata SSRF hole. This ratchet:
 *
 *   1. exercises `assertPublicAddress` against literal-private, metadata and a
 *      DNS-rebinding (public name → private IP) case (mocked resolver);
 *   2. structurally asserts each curated tenant-controlled outbound sink
 *      routes through `safeFetch` and calls no other fetch of any name.
 *
 * A new outbound sink on a tenant-derived URL must use `safeFetch` (and be
 * added to SINKS) or this fails CI. Sub-phase 5.1 adds the automation webhook
 * action, 5.x the integrations, 6.2 the MCP clients and 8.3 the OIDC client,
 * each with its sink row.
 *
 * Copied from inflect-compliance `tests/guards/ssrf-egress-coverage.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e, cut to Islestone's one sink
 * (docs/porting/maps/1.5.md): the bot seam, MCP transport, OIDC and
 * in-deployment-service blocks go with their subsystems.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Mock the resolver so the rebinding case is deterministic ───────
const mockLookup = jest.fn<Promise<{ address: string; family: number }[]>, [string, unknown]>();
jest.mock('node:dns', () => ({
    promises: { lookup: (host: string, opts: unknown) => mockLookup(host, opts) },
}));

import { assertPublicAddress, isPrivateAddress, SsrfBlockedError } from '@/app-layer/automation/webhook-safety';
import { codeOf } from '../helpers/source-blocks';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('SSRF — isPrivateAddress', () => {
    it('flags cloud-metadata, RFC-1918, CGNAT, loopback, and v6 loopback', () => {
        for (const ip of ['169.254.169.254', '10.0.0.1', '172.16.0.1', '192.168.1.1', '127.0.0.1', '100.64.0.1', '::1', '0.0.0.0']) {
            expect(isPrivateAddress(ip)).toBe(true);
        }
    });
    it('allows genuine public addresses', () => {
        for (const ip of ['93.184.216.34', '8.8.8.8', '1.1.1.1']) {
            expect(isPrivateAddress(ip)).toBe(false);
        }
    });
});

describe('SSRF — assertPublicAddress', () => {
    beforeEach(() => mockLookup.mockReset());

    it('rejects non-https', async () => {
        await expect(assertPublicAddress('http://example.com/')).rejects.toBeInstanceOf(SsrfBlockedError);
    });

    it('rejects literal cloud-metadata + RFC-1918 + v6 loopback + localhost (before DNS)', async () => {
        for (const url of ['https://169.254.169.254/latest/meta-data', 'https://10.0.0.1/', 'https://[::1]/', 'https://localhost/']) {
            await expect(assertPublicAddress(url)).rejects.toBeInstanceOf(SsrfBlockedError);
        }
        expect(mockLookup).not.toHaveBeenCalled(); // literal cases short-circuit
    });

    it('rejects a public hostname that RESOLVES to private space (DNS rebinding)', async () => {
        mockLookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }]);
        await expect(assertPublicAddress('https://rebind.example.com/')).rejects.toThrow(/private address 10\.0\.0\.1/);
    });

    it('rejects when ANY resolved address is private (multi-record)', async () => {
        mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }]);
        await expect(assertPublicAddress('https://mixed.example.com/')).rejects.toBeInstanceOf(SsrfBlockedError);
    });

    it('accepts a public hostname resolving to public space', async () => {
        mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
        const r = await assertPublicAddress('https://good.example.com/');
        expect(r.host).toBe('good.example.com');
        expect(r.addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
    });
});

// ─── Curated tenant-controlled outbound sinks ──────────────────────
// Each MUST import + use safeFetch and carry no other fetch call.
const SINKS: { file: string; reason: string }[] = [
    {
        file: 'src/app-layer/events/audit-stream.ts',
        reason: 'Tenant-controlled auditStreamUrl (the metadata-SSRF hole in inflect-compliance).',
    },
];

/**
 * ANY identifier ending in `fetch`, not a list of the ones we thought of.
 * inflect-compliance's earlier `\bfetch\(` missed `resilientFetch(` (#3480
 * there), a wrapper that bounds size and time and does NO address filtering.
 */
const ANY_FETCH_CALL = /\w*fetch\s*\(/gi;

/** Fetch calls in `code` other than `safeFetch(`. */
function otherFetchCalls(code: string): string[] {
    return (code.match(ANY_FETCH_CALL) ?? []).filter((call) => !/^safeFetch\s*\(/.test(call));
}

/** Does `src` import safeFetch from the kept path and call it? */
function usesSafeFetch(src: string): boolean {
    return /from '(\.\/|@\/app-layer\/automation\/)webhook-safety'/.test(src) && /\bsafeFetch\s*\(/.test(codeOf(src));
}

describe('SSRF — every tenant-controlled sink routes through safeFetch', () => {
    for (const sink of SINKS) {
        it(`${sink.file} uses safeFetch and no other fetch (${sink.reason})`, () => {
            const src = read(sink.file);
            expect(usesSafeFetch(src)).toBe(true);
            expect(otherFetchCalls(codeOf(src))).toEqual([]);
        });
    }

    it('the checks catch every fetch alias, against synthetic source', () => {
        for (const call of [
            'await fetch(opts.url)',
            'await resilientFetch(opts.url)',
            'await boundedFetch(opts.url)',
            'const r = retryingFetch(u)',
        ]) {
            expect({ call, caught: otherFetchCalls(call) }).toEqual({ call, caught: [expect.any(String)] });
        }
        // safeFetch alone is not "another" fetch, and a comment naming one is
        // not a call once masked.
        expect(otherFetchCalls('await safeFetch(url)')).toEqual([]);
        expect(otherFetchCalls(codeOf('// fetch(url) is refused here\nawait safeFetch(url)'))).toEqual([]);
        // The import is half the claim: a file calling safeFetch from some
        // other module, or importing it and never calling it, fails.
        expect(usesSafeFetch("import { safeFetch } from '@/app-layer/automation/webhook-safety';\nawait safeFetch(u);")).toBe(true);
        expect(usesSafeFetch("import { safeFetch } from './elsewhere';\nawait safeFetch(u);")).toBe(false);
        expect(usesSafeFetch("import { safeFetch } from '@/app-layer/automation/webhook-safety';\n")).toBe(false);
    });
});
