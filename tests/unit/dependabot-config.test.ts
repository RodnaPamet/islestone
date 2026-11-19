/**
 * `.github/dependabot.yml` keeps two owner decisions.
 *
 * - Pull request titles are Conventional Commits (decision 51), and the
 *   `PR title` check fails any other. Dependabot's default "Bump x from a to b"
 *   failed it on its first grouped pull request (#28), so every ecosystem names
 *   a Conventional type as its prefix.
 * - The majors the owner held on 2026-11-19 stay held: TypeScript 7, ioredis 6,
 *   and Redis 8, whose RSALv2/SSPLv1/AGPLv3 licence is not 7.x's BSD-3-Clause.
 *   The Redis image in both compose files stays on 7.x to match.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as yaml from 'js-yaml';

import { checkPrTitle, TYPES } from '../../scripts/check-pr-title.mjs';

const REPO = path.resolve(__dirname, '../..');

interface Ignore {
    'dependency-name': string;
    versions?: string[];
}
interface Update {
    'package-ecosystem': string;
    directory: string;
    'commit-message'?: { prefix?: string; 'prefix-development'?: string; include?: string };
    ignore?: Ignore[];
}

const config = yaml.load(fs.readFileSync(path.join(REPO, '.github/dependabot.yml'), 'utf8')) as {
    updates: Update[];
};
const update = (ecosystem: string): Update => {
    const u = config.updates.find((x) => x['package-ecosystem'] === ecosystem);
    if (!u) throw new Error(`no ${ecosystem} entry`);
    return u;
};
const heldFrom = (u: Update, name: string): string[] | undefined =>
    u.ignore?.find((i) => i['dependency-name'] === name)?.versions;

describe('Dependabot configuration', () => {
    it('every ecosystem titles its pull requests as Conventional Commits', () => {
        expect(config.updates.length).toBeGreaterThan(0);
        for (const u of config.updates) {
            const msg = u['commit-message'];
            expect({ ecosystem: u['package-ecosystem'], prefix: msg?.prefix }).toEqual({
                ecosystem: u['package-ecosystem'],
                prefix: expect.any(String),
            });
            expect(TYPES).toContain(msg!.prefix);
            if (msg!['prefix-development'] !== undefined) expect(TYPES).toContain(msg!['prefix-development']);
            expect(msg!.include).toBe('scope');
            // The title Dependabot builds from it, as on #28 after its retitle.
            const title = `${msg!.prefix}(deps): bump the minor-and-patch group with 6 updates`;
            expect(checkPrTitle(title)).toMatchObject({ ok: true });
        }
    });

    it('holds the majors the owner decided to hold', () => {
        expect(heldFrom(update('npm'), 'typescript')).toEqual(['>=7']);
        expect(heldFrom(update('npm'), 'ioredis')).toEqual(['>=6']);
        expect(heldFrom(update('docker-compose'), 'redis')).toEqual(['>=8']);
    });

    it('both compose files run Redis 7.x', () => {
        for (const file of ['docker-compose.yml', 'deploy/docker-compose.prod.yml']) {
            const images = [...fs.readFileSync(path.join(REPO, file), 'utf8').matchAll(/^\s*image:\s*"?redis:([^\s"]+)/gm)];
            expect({ file, count: images.length }).toEqual({ file, count: 1 });
            expect({ file, tag: images[0]![1] }).toEqual({ file, tag: expect.stringMatching(/^7\./) });
        }
    });
});
