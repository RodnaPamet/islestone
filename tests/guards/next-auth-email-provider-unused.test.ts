/**
 * GUARD — nothing imports next-auth's email provider.
 *
 * `package.json` overrides next-auth's optional `nodemailer` peer to the root
 * version (`"overrides": { "next-auth": { "nodemailer": "$nodemailer" } }`,
 * ADR 0004 open question 7, owner decision 2026-11-19). next-auth 4.24.15
 * declares `nodemailer@^7.0.7`; Islestone installs 10.x for its own mailer, and
 * npm refuses the install without the override. The override is safe only
 * while next-auth never sends mail itself: its email provider
 * (`next-auth/providers/email`) is the one part of next-auth that calls
 * nodemailer, and it was written against 7.x.
 *
 * So the first import of that provider, anywhere in the repository, fails
 * here, and the override is revisited before the provider is used. The
 * population comes from git, and a planted repository proves the detector.
 *
 * Written for Islestone (sub-phase 1.6).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import { gitFiles } from '../helpers/git-files';
import { analyseModule } from '../helpers/import-graph';

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const EMAIL_PROVIDER = /^next-auth\/providers\/email(?:\.js)?$/;

/** Repo-relative files whose module graph names next-auth's email provider. */
function importersOfEmailProvider(root: string): string[] {
    return gitFiles(root)
        .filter((f) => SOURCE.test(f) && !f.startsWith('node_modules/') && !f.startsWith('tests/fixtures/'))
        .filter((f) => {
            const file = path.join(root, f);
            if (!fs.existsSync(file)) return false;
            const facts = analyseModule(fs.readFileSync(file, 'utf8'), f);
            return facts.specifiers.some((s) => EMAIL_PROVIDER.test(s));
        })
        .sort();
}

describe('GUARD: next-auth\'s email provider is not imported (the nodemailer override depends on it)', () => {
    it('the override this guard protects is still declared', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
            overrides?: Record<string, unknown>;
            dependencies?: Record<string, string>;
        };
        expect(pkg.overrides?.['next-auth']).toEqual({ nodemailer: '$nodemailer' });
        expect(pkg.dependencies?.nodemailer).toBeDefined();
    });

    it('no source file imports next-auth/providers/email', () => {
        expect(importersOfEmailProvider(ROOT)).toEqual([]);
    });

    it('the detector finds a planted import, a require and a dynamic import, and ignores prose', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextauth-email-'));
        try {
            const write = (rel: string, body: string) => {
                fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
                fs.writeFileSync(path.join(dir, rel), body);
            };
            execFileSync('git', ['init', '-q'], { cwd: dir });
            write('src/auth.ts', "import EmailProvider from 'next-auth/providers/email';\nexport const p = EmailProvider;\n");
            write('src/lazy.ts', "export const load = () => import('next-auth/providers/email');\n");
            write('scripts/old.js', "const Email = require('next-auth/providers/email');\nmodule.exports = Email;\n");
            write('src/fine.ts', "// import EmailProvider from 'next-auth/providers/email';\nimport Google from 'next-auth/providers/google';\nexport const g = Google;\n");
            expect(importersOfEmailProvider(dir)).toEqual(['scripts/old.js', 'src/auth.ts', 'src/lazy.ts']);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
