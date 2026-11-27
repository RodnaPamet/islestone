/**
 * Time is a person's own statement, written through one seam (sub-phase
 * 3.4b; docs/porting/maps/3.4.md, "Writes"; ADR 0012 §2; owner decisions 267
 * and 278).
 *
 *   1. Only `src/app-layer/repositories/TimeEntryRepository.ts` reaches the
 *      `TimeEntry` table: no other file under `src/` names it in SQL or uses
 *      its Prisma delegate.
 *   2. The repository's writing methods (those that create, update or delete
 *      through the delegate) are called only from the writing usecases,
 *      `WRITERS` (3.4c's `timesheet.ts` joins them).
 *   3. Every exported write of `time-entry.ts` asks `assertRecordsTime` (the
 *      `time.track` key and a person: never an API key, an agent, a job or the
 *      system user), except the member-removal stop, which only
 *      `removeTenantMember` calls.
 *   4. No job module imports a writing usecase: no job writes time.
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

const SEAM = 'src/app-layer/repositories/TimeEntryRepository.ts';
const WRITERS = ['src/app-layer/usecases/time-entry.ts'];
const WRITE_CALL = /\.timeEntry\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;

function sources(root: string): string[] {
    return gitFiles(root).filter((rel) => rel.startsWith('src/') && /\.tsx?$/.test(rel));
}

/** Files other than the seam that reach the table. */
function tableTouchers(root: string): string[] {
    return sources(root)
        .filter((rel) => rel !== SEAM)
        .filter((rel) => {
            const src = fs.readFileSync(path.join(root, rel), 'utf8');
            return /"TimeEntry"/.test(src) || /\.timeEntry\b/.test(src);
        });
}

/** The seam's methods that write through the delegate. */
function writingMethods(root: string): string[] {
    if (!fs.existsSync(path.join(root, SEAM))) return [];
    const sf = ts.createSourceFile(SEAM, fs.readFileSync(path.join(root, SEAM), 'utf8'), ts.ScriptTarget.Latest, true);
    const out: string[] = [];
    const visit = (node: ts.Node) => {
        if (ts.isMethodDeclaration(node) && node.body && WRITE_CALL.test(node.body.getText(sf))) out.push(node.name.getText(sf));
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out.sort();
}

function enclosingFunction(node: ts.Node, sf: ts.SourceFile): string | null {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
        if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText(sf);
    }
    return null;
}

/** `file#function` of every call of `name` (a bare or member call) outside `except`. */
function callersOf(root: string, name: RegExp, except: readonly string[]): string[] {
    const out: string[] = [];
    for (const rel of sources(root).filter((r) => !except.includes(r))) {
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node) && name.test(node.expression.getText(sf))) out.push(`${rel}#${enclosingFunction(node, sf) ?? '<top level>'}`);
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return out.sort();
}

/** Calls of the seam's writing methods outside the writing usecases. */
function strayWrites(root: string): string[] {
    const methods = writingMethods(root);
    if (methods.length === 0) return [];
    return callersOf(root, new RegExp(`\\bTimeEntryRepository\\.(${methods.join('|')})$`), [SEAM, ...WRITERS]);
}

/** Job modules that import a writing usecase. */
function jobImporters(root: string): string[] {
    const writerModules = WRITERS.map((w) => w.replace(/^src\//, '').replace(/\.ts$/, '').split('/').pop()!);
    return sources(root)
        .filter((rel) => rel.startsWith('src/app-layer/jobs/'))
        .filter((rel) => {
            const src = fs.readFileSync(path.join(root, rel), 'utf8');
            return writerModules.some((m) => new RegExp(`from\\s+['"][^'"]*usecases/${m}['"]`).test(src));
        });
}

/** The exported async functions of a writing usecase and whether each asks `assertRecordsTime(ctx`. */
function exportedWrites(root: string, rel: string): Record<string, boolean> {
    const sf = ts.createSourceFile(rel, fs.readFileSync(path.join(root, rel), 'utf8'), ts.ScriptTarget.Latest, true);
    const out: Record<string, boolean> = {};
    for (const s of sf.statements) {
        if (!ts.isFunctionDeclaration(s) || !s.name || !s.body) continue;
        if (!s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
        const body = s.body.getText(sf);
        if (!/TimeEntryRepository\.(create|updateVersioned|finishTimer|delete)\b|stopRunningInTx\(/.test(body)) continue;
        out[s.name.text] = /assertRecordsTime\(ctx,/.test(body);
    }
    return out;
}

describe('time entries — one seam, a person only', () => {
    it('only TimeEntryRepository reaches the TimeEntry table', () => {
        expect(tableTouchers(REPO_ROOT)).toEqual([]);
    });

    it('finds the writing methods (the population is real)', () => {
        expect(writingMethods(REPO_ROOT)).toEqual(['create', 'delete', 'finishTimer', 'updateVersioned']);
    });

    it('only the writing usecases call them', () => {
        expect(strayWrites(REPO_ROOT)).toEqual([]);
    });

    it("every exported write asks for a person recording their own time, but the removal's stop", () => {
        expect(exportedWrites(REPO_ROOT, 'src/app-layer/usecases/time-entry.ts')).toEqual({
            addTimeEntry: true,
            updateTimeEntry: true,
            deleteTimeEntry: true,
            startTimer: true,
            stopTimer: true,
            stopTimerOfRemovedMemberInTx: false,
        });
        expect(callersOf(REPO_ROOT, /\bstopTimerOfRemovedMemberInTx$/, WRITERS)).toEqual(['src/app-layer/usecases/tenant-admin.ts#removeTenantMember']);
    });

    it('no job imports a writing usecase', () => {
        expect(jobImporters(REPO_ROOT)).toEqual([]);
    });
});

describe('the detectors, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-time-seam-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant = (rel: string, content: string) => {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        };
        plant(
            SEAM,
            [
                'export class TimeEntryRepository {',
                '    static async get(db, ctx, id) { return db.timeEntry.findFirst({ where: { id } }); }',
                '    static async create(db, ctx, data) { return db.timeEntry.create({ data }); }',
                '    static async wipe(db, ctx) { return db.timeEntry.deleteMany({ where: {} }); }',
                '}',
            ].join('\n'),
        );
        plant(WRITERS[0]!, 'export async function addTimeEntry(ctx) {\n    await assertRecordsTime(ctx, "add");\n    return TimeEntryRepository.create(db, ctx, {});\n}\nexport async function sneak(ctx) {\n    return TimeEntryRepository.create(db, ctx, {});\n}\n');
        plant('src/app-layer/jobs/robot.ts', "import { addTimeEntry } from '../usecases/time-entry';\nexport async function nightly(db, ctx) {\n    await TimeEntryRepository.wipe(db, ctx);\n}\n");
        plant('src/app-layer/usecases/sneaky.ts', 'export const q = Prisma.sql`DELETE FROM "TimeEntry"`;\n');
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('flags SQL against the table outside the seam', () => {
        expect(tableTouchers(root)).toEqual(['src/app-layer/usecases/sneaky.ts']);
    });

    it('flags a writing method called outside the writing usecases, and passes a read', () => {
        expect(writingMethods(root)).toEqual(['create', 'wipe']);
        expect(strayWrites(root)).toEqual(['src/app-layer/jobs/robot.ts#nightly']);
    });

    it('flags an exported write that does not ask for a person', () => {
        expect(exportedWrites(root, WRITERS[0]!)).toEqual({ addTimeEntry: true, sneak: false });
    });

    it('flags a job importing a writing usecase', () => {
        expect(jobImporters(root)).toEqual(['src/app-layer/jobs/robot.ts']);
    });
});
