/**
 * Only people review, through one seam (sub-phase 2.8a; ADR 0009 §10; owner
 * decisions 158 and 162).
 *
 *   1. Only `src/app-layer/repositories/ReviewRepository.ts` reaches the
 *      reviewer table: no other file under `src/` names it in SQL or uses its
 *      Prisma delegate.
 *   2. In that repository, a reviewer's `outcome` is written by one method,
 *      `recordResponse`: no other write's `data` names `outcome`.
 *   3. `recordResponse` is called by one function, `respondToReviewStep`
 *      (`src/app-layer/usecases/review.ts`), which asks `assertActingAsPerson`
 *      and that the caller is the named reviewer. So no job, automation rule,
 *      import or later agent path can stamp a response.
 *
 * The population comes from git; the detectors prove themselves against a
 * planted repository.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ts from 'typescript';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';

const SEAM = 'src/app-layer/repositories/ReviewRepository.ts';

function sources(root: string): string[] {
    return gitFiles(root).filter((rel) => rel.startsWith('src/') && /\.tsx?$/.test(rel));
}

/** Files other than the seam that reach the reviewer table. */
function tableTouchers(root: string): string[] {
    return sources(root)
        .filter((rel) => rel !== SEAM)
        .filter((rel) => {
            const src = fs.readFileSync(path.join(root, rel), 'utf8');
            return /"WorkItemReviewer"/.test(src) || /\.workItemReviewer\b/.test(src);
        });
}

function enclosingFunction(node: ts.Node): string | null {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
        if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText();
    }
    return null;
}

/**
 * The methods of the seam whose write `data` names `outcome`: an object
 * literal with an `outcome` key, or a parameter passed as `data` whose
 * declared type names one.
 */
function outcomeWriters(root: string): string[] {
    if (!fs.existsSync(path.join(root, SEAM))) return [];
    const sf = ts.createSourceFile(SEAM, fs.readFileSync(path.join(root, SEAM), 'utf8'), ts.ScriptTarget.Latest, true);
    const out = new Set<string>();
    const methodOf = (node: ts.Node): ts.MethodDeclaration | null => {
        for (let n: ts.Node | undefined = node.parent; n; n = n.parent) if (ts.isMethodDeclaration(n)) return n;
        return null;
    };
    const paramNamesOutcome = (m: ts.MethodDeclaration, name: string) => {
        const p = m.parameters.find((x) => x.name.getText(sf) === name);
        return Boolean(p?.type && /\boutcome\b/.test(p.type.getText(sf)));
    };
    const visit = (node: ts.Node) => {
        const m = methodOf(node);
        if (m && ts.isPropertyAssignment(node) && node.name.getText(sf) === 'data') {
            const init = node.initializer;
            const literalNames =
                ts.isObjectLiteralExpression(init) &&
                init.properties.some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText(sf) === 'outcome');
            if (literalNames || (ts.isIdentifier(init) && paramNamesOutcome(m, init.text))) out.add(m.name.getText(sf));
        }
        if (m && ts.isShorthandPropertyAssignment(node) && node.name.getText(sf) === 'data' && paramNamesOutcome(m, 'data')) out.add(m.name.getText(sf));
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return [...out].sort();
}

/** `file#function` of every call of `recordResponse` outside the seam. */
function recordResponseCallers(root: string): string[] {
    const out: string[] = [];
    for (const rel of sources(root).filter((r) => r !== SEAM)) {
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        if (!text.includes('recordResponse')) continue;
        const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node) && /\brecordResponse$/.test(node.expression.getText(sf))) out.push(`${rel}#${enclosingFunction(node) ?? '<top level>'}`);
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return out.sort();
}

describe('review responses — one seam', () => {
    it('only ReviewRepository reaches the reviewer table', () => {
        expect(tableTouchers(REPO_ROOT)).toEqual([]);
    });

    it("only recordResponse writes a reviewer's outcome", () => {
        expect(outcomeWriters(REPO_ROOT)).toEqual(['recordResponse']);
    });

    it('only respondToReviewStep records a response, as a person and the named reviewer', () => {
        expect(recordResponseCallers(REPO_ROOT)).toEqual(['src/app-layer/usecases/review.ts#respondToReviewStep']);
        const src = fs.readFileSync(path.join(REPO_ROOT, 'src/app-layer/usecases/review.ts'), 'utf8');
        const sf = ts.createSourceFile('review.ts', src, ts.ScriptTarget.Latest, true);
        const fn = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'respondToReviewStep')!;
        const body = fn.getText(sf);
        expect(body).toMatch(/assertActingAsPerson\(ctx,/);
        expect(body).toMatch(/r\.userId === ctx\.userId/);
        expect(body).toMatch(/isOwnWork\(ctx\.userId, item\)/);
    });
});

describe('the detectors, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-review-seam-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant = (rel: string, content: string) => {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        };
        plant(
            SEAM,
            [
                'export class ReviewRepository {',
                '    static async recordResponse(db, ctx, id, previous, data: { outcome: string }) {',
                '        return db.workItemReviewer.updateMany({ where: { id, outcome: previous }, data });',
                '    }',
                '    static async withdraw(db, ctx, ids) {',
                '        return db.workItemReviewer.updateMany({ where: { id: { in: ids }, outcome: null }, data: { withdrawnAt: new Date() } });',
                '    }',
                '    static async stamp(db, ctx, id) {',
                "        return db.workItemReviewer.update({ where: { id }, data: { outcome: 'SIGNED_OFF' } });",
                '    }',
                '}',
            ].join('\n'),
        );
        plant('src/app-layer/jobs/robot.ts', 'export async function nightly(db, ctx) {\n    await ReviewRepository.recordResponse(db, ctx, "r", null, { outcome: "SIGNED_OFF" });\n}\n');
        plant('src/app-layer/usecases/sneaky.ts', 'export const q = Prisma.sql`UPDATE "WorkItemReviewer" SET "outcome" = \'RETURNED\'`;\n');
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('flags a second outcome writer in the seam, and passes the where clauses', () => {
        expect(outcomeWriters(root)).toEqual(['recordResponse', 'stamp']);
    });

    it('flags a caller of recordResponse other than the respond usecase', () => {
        expect(recordResponseCallers(root)).toEqual(['src/app-layer/jobs/robot.ts#nightly']);
    });

    it('flags SQL against the table outside the seam', () => {
        expect(tableTouchers(root)).toEqual(['src/app-layer/usecases/sneaky.ts']);
    });
});
