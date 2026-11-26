/**
 * The audit extension in `src/lib/prisma.ts` writes an `entity_lifecycle` row
 * for every write except to the models in `EXCLUDED_MODELS`. Each entry
 * removes a table from the audit trail, so each one is an owner decision:
 *
 * - `AuditLog`: the extension must not audit its own writes (recursion).
 * - `CalendarSyncedEvent`: calendar sync's bookkeeping of what it pushed
 *   (3.3b, owner decision 2026-11-26).
 *
 * The guard holds the set to exactly these, so a new exclusion fails here
 * until it is decided and listed.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { codeOf } from '../helpers/source-blocks';

const PRISMA_FILE = path.resolve(__dirname, '../../src/lib/prisma.ts');
const DECIDED = ['AuditLog', 'CalendarSyncedEvent'];

/** The string entries of the `EXCLUDED_MODELS` set literal, or null when there is no such literal. */
export function excludedModels(source: string): string[] | null {
    const code = codeOf(source);
    const m = /const\s+EXCLUDED_MODELS\s*=\s*new\s+Set\(\s*\[([^\]]*)\]\s*\)/.exec(code);
    if (!m) return null;
    const body = m[1]!;
    const entries = [...body.matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2]!);
    // Anything in the literal besides quoted names and commas (a spread, an identifier) is unreadable.
    const rest = body.replace(/'[^']*'|"[^"]*"/g, '').replace(/[\s,]/g, '');
    return rest === '' ? entries : null;
}

describe('the audit extension excludes only the decided models', () => {
    it('EXCLUDED_MODELS is exactly the decided set', () => {
        expect(excludedModels(fs.readFileSync(PRISMA_FILE, 'utf8'))?.sort()).toEqual([...DECIDED].sort());
    });

    it('reads a planted set, reports an added model, ignores comments, and refuses what it cannot read', () => {
        const planted = "const EXCLUDED_MODELS = new Set([\n    'AuditLog', // recursion\n    // 'Commented'\n    'WorkItem',\n]);\n";
        expect(excludedModels(planted)).toEqual(['AuditLog', 'WorkItem']);
        expect(excludedModels('const EXCLUDED_MODELS = new Set([...MORE, \'AuditLog\']);')).toBeNull();
        expect(excludedModels('const OTHER = new Set([]);')).toBeNull();
    });
});
