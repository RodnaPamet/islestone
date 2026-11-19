/**
 * deploy/caddy/islestone.caddy — Islestone's site on the shared Caddy
 * (owner decision 44, 2026-11-19).
 *
 * The file is imported into Agrent's Caddyfile, so it may hold site blocks and
 * nothing else: no global options block and no snippet definition, either of
 * which would land in Agrent's configuration. It serves exactly
 * islestone.cloud (www redirects to it), proxies to the container the compose
 * file names, sets the client address from the connection, and carries the
 * same HSTS value as the app. `caddy validate` runs on the VM, inside
 * agrent-caddy, before every reload (deploy/apply.sh).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { HSTS_MAX_AGE_SECONDS } from '@/lib/security-headers';

import { loadCompose } from '../../helpers/compose-file';

const REPO = path.resolve(__dirname, '../../..');
const TEXT = fs.readFileSync(path.join(REPO, 'deploy/caddy/islestone.caddy'), 'utf8');

interface Block {
    readonly head: string;
    readonly body: string;
}

/** Top-level blocks: the text before each `{` at depth 0, and its body. */
function topLevelBlocks(text: string): Block[] {
    const code = text
        .split('\n')
        .map((line) => line.replace(/(^|\s)#.*$/, ''))
        .join('\n');
    const blocks: Block[] = [];
    let depth = 0;
    let head = '';
    let body = '';
    for (const ch of code) {
        if (ch === '{') {
            if (depth > 0) body += ch;
            depth += 1;
        } else if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                // A block's head is one line of addresses; anything above it
                // on its own line is a top-level directive (an import, say).
                if (head.trim().includes('\n')) throw new Error(`text outside any block: ${head.trim()}`);
                blocks.push({ head: head.trim(), body });
                head = '';
                body = '';
            } else body += ch;
        } else if (depth === 0) head += ch;
        else body += ch;
    }
    if (depth !== 0) throw new Error('unbalanced braces');
    if (head.trim() !== '') throw new Error(`text outside any block: ${head.trim()}`);
    return blocks;
}

const blocks = topLevelBlocks(TEXT);
const site = (host: string): Block => {
    const b = blocks.find((x) => x.head.split(/[\s,]+/).includes(host));
    if (!b) throw new Error(`no site block for ${host}`);
    return b;
};

describe('the parser', () => {
    it('finds blocks and refuses stray text (not vacuous)', () => {
        expect(topLevelBlocks('a.example {\n\tfoo { bar }\n}\n# c\nb.example {\n}\n').map((b) => b.head)).toEqual([
            'a.example',
            'b.example',
        ]);
        expect(() => topLevelBlocks('import x\na {\n}\n')).toThrow(/outside any block/);
        expect(() => topLevelBlocks('a {\n')).toThrow(/unbalanced/);
    });
});

describe('deploy/caddy/islestone.caddy', () => {
    it('holds exactly two site blocks, for the apex and www, and nothing global', () => {
        expect(blocks.map((b) => b.head)).toEqual(['www.islestone.cloud', 'islestone.cloud']);
        expect(blocks.some((b) => b.head === '' || b.head.startsWith('('))).toBe(false);
    });

    it('redirects www to the apex permanently, keeping the path', () => {
        expect(site('www.islestone.cloud').body.trim()).toBe('redir https://islestone.cloud{uri} permanent');
    });

    it('proxies the apex to the app container the compose file names', () => {
        const app = loadCompose(path.join(REPO, 'deploy/docker-compose.prod.yml')).services.app;
        const upstream = /reverse_proxy\s+(\S+)\s*\{/.exec(site('islestone.cloud').body)?.[1];
        expect(upstream).toBe(`${app?.container_name}:3000`);
    });

    it('sets the forwarded client address from the connection, never from the request', () => {
        const body = site('islestone.cloud').body;
        expect(body).toMatch(/header_up X-Forwarded-For \{remote_host\}/);
        expect(body).toMatch(/header_up X-Real-IP \{remote_host\}/);
        expect(body).toMatch(/header_up X-Forwarded-Proto \{scheme\}/);
        expect(body).toMatch(/header_up Host \{host\}/);
    });

    it("sends the app's own HSTS value", () => {
        expect(site('islestone.cloud').body).toContain(
            `Strict-Transport-Security "max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains"`,
        );
    });

    it('limits the request body', () => {
        expect(site('islestone.cloud').body).toMatch(/request_body \{\s*max_size \d+MB\s*\}/);
    });
});
