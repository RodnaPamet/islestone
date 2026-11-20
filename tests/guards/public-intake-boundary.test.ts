/**
 * The public intake surface's boundary (sub-phase 2.6b; owner decision 98;
 * docs/porting/maps/2.6.md "Tenant resolution without disclosure").
 *
 * 1. The public modules (the `/f/` pages, the two public routes, their gates
 *    in `src/lib/intake/public/` and the public page components) reach the
 *    application layer through ONE module, `intake-public.ts` (the resolver,
 *    the submit and the confirmation), and never read a session: no
 *    repository, no other usecase, no `getTenantCtx`, no session module, no
 *    NextAuth, no cookies. A public link must not be able to reach anything a
 *    workspace's members can.
 * 2. The `public-intake-resolve` bypass reason is used in `intake-public.ts`
 *    and nowhere else, so the surface's pre-tenant reads stay in one file.
 *
 * The population comes from git; each check is proved against planted
 * sources, so it cannot pass by checking nothing.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { gitFiles, REPO_ROOT } from '../helpers/git-files';

const PUBLIC_ROOTS = ['src/app/f/', 'src/app/api/intake/', 'src/lib/intake/public/', 'src/components/intake/public/'];
const ALLOWED_APP_LAYER = new Set(['@/app-layer/usecases/intake-public']);
const FORBIDDEN = [/^@\/lib\/auth\/session$/, /^@\/app-layer\/context$/, /^next-auth(\/|$)/, /^@next-auth\//, /^@\/auth$/, /^@\/lib\/prisma$/, /^@\/lib\/db-context$/];
const RESOLVE_SITES = new Set(['src/app-layer/usecases/intake-public.ts']);

interface Source {
    file: string;
    src: string;
}

function importsOf(src: string): string[] {
    const out: string[] = [];
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)) out.push(m[1]!);
    return out;
}

function boundaryViolations(sources: readonly Source[]): string[] {
    const bad: string[] = [];
    for (const { file, src } of sources) {
        for (const spec of importsOf(src)) {
            if (spec.startsWith('@/app-layer/') && !ALLOWED_APP_LAYER.has(spec)) bad.push(`${file} imports ${spec}`);
            if (FORBIDDEN.some((re) => re.test(spec))) bad.push(`${file} imports ${spec}`);
            if (spec === 'next/headers' && /\bcookies\s*\(/.test(src)) bad.push(`${file} reads cookies`);
        }
        if (/\bgetSession\s*\(|\bgetServerSession\s*\(|\bgetToken\s*\(/.test(src)) bad.push(`${file} reads a session`);
    }
    return bad;
}

function resolveReasonSites(sources: readonly Source[]): string[] {
    return sources.filter((s) => /reason:\s*['"]public-intake-resolve['"]/.test(s.src)).map((s) => s.file);
}

function read(files: string[]): Source[] {
    return files.map((file) => ({ file, src: fs.readFileSync(path.join(REPO_ROOT, file), 'utf8') }));
}

const ALL = gitFiles(REPO_ROOT).filter((f) => /\.(ts|tsx)$/.test(f));
const PUBLIC = ALL.filter((f) => PUBLIC_ROOTS.some((r) => f.startsWith(r)));

describe('the public intake modules', () => {
    it('exist (the population is not empty)', () => {
        expect(PUBLIC).toEqual(
            expect.arrayContaining([
                'src/app/f/[publicId]/page.tsx',
                'src/app/f/confirm/[token]/page.tsx',
                'src/app/api/intake/forms/[publicId]/route.ts',
                'src/app/api/intake/confirm/route.ts',
                'src/lib/intake/public/http.ts',
            ]),
        );
    });

    it('reach the application layer only through intake-public.ts, and read no session', () => {
        expect(boundaryViolations(read(PUBLIC))).toEqual([]);
    });

    it('the check catches a planted repository import, a planted session read and a planted cookie read', () => {
        const planted: Source[] = [
            { file: 'src/app/f/x/page.tsx', src: "import { IntakeRepository } from '@/app-layer/repositories/IntakeRepository';" },
            { file: 'src/app/f/y/page.tsx', src: "import { getSession } from '@/lib/auth/session';\nawait getSession();" },
            { file: 'src/app/f/z/page.tsx', src: "import { cookies } from 'next/headers';\nconst c = await cookies();" },
            { file: 'src/app/f/ok/page.tsx', src: "import { getPublicIntakeForm } from '@/app-layer/usecases/intake-public';" },
        ];
        const bad = boundaryViolations(planted);
        expect(bad).toEqual(
            expect.arrayContaining([
                'src/app/f/x/page.tsx imports @/app-layer/repositories/IntakeRepository',
                'src/app/f/y/page.tsx imports @/lib/auth/session',
                'src/app/f/y/page.tsx reads a session',
                'src/app/f/z/page.tsx reads cookies',
            ]),
        );
        expect(bad.some((b) => b.startsWith('src/app/f/ok/'))).toBe(false);
    });
});

describe('the public-intake-resolve bypass reason', () => {
    it('is used in intake-public.ts and nowhere else', () => {
        const sites = resolveReasonSites(read(ALL.filter((f) => f.startsWith('src/'))));
        expect(sites.length).toBeGreaterThan(0);
        expect(sites.filter((f) => !RESOLVE_SITES.has(f))).toEqual([]);
    });

    it('the check finds a planted site', () => {
        expect(resolveReasonSites([{ file: 'src/x.ts', src: "runWithoutRls({ reason: 'public-intake-resolve' }, f)" }])).toEqual(['src/x.ts']);
    });
});
