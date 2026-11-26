/**
 * The schema speaks ADR 0006's vocabulary (docs/adr/0006-vocabulary.md,
 * "Recommended enforcement": a schema test, added with the first model).
 *
 * Two rules, over the concatenated `prisma/schema` with comments masked:
 *
 *   (a) No `@map` or `@@map` anywhere unless the ADR admits it (rule 3:
 *       physical names equal Prisma names). The ADR admits none today, which
 *       also keeps `User`'s dropped `@map("emailEncrypted")` from returning.
 *
 *   (b) No model, enum, field or enum value uses a word the ADR's "Words NOT
 *       to use" column bans. The words are READ FROM THE ADR TABLE, not
 *       copied, so an amendment to the table changes this guard in the same
 *       change. A banned word is enforced schema-wide only when it is
 *       unqualified and names no concept anywhere in the table (Task, Issue,
 *       Sprint, Employee, the spelling CANCELED …). A word the table qualifies
 *       ("Tenant (in UI text)", "Owner (unqualified: OWNER is a role)") or
 *       uses as another concept's name (Agent, Template, Status, Board …) is
 *       CONTEXT-DEPENDENT: banned for one concept, correct for another, which
 *       a schema scan cannot tell apart. Those are listed by the parser and
 *       left to review. A word qualified "as a model" is enforced on model and
 *       enum names only.
 *
 * Identifiers are split into words (camelCase, PascalCase, SNAKE_CASE) and a
 * banned phrase matches a run of whole words, so `passwordHash` does not
 * match "Pass" and `sessionVersion` is judged on "session" and "version".
 *
 * The ESLint identifier rule and the `messages/en.json` catalogue check in the
 * same ADR section belong to the sub-phases that create `src/` domain
 * identifiers (2.1) and the catalogue (1.7).
 *
 * The last block runs both rules on a planted schema.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { readPrismaSchema } from '../helpers/prisma-schema';
import { codeOf } from '../helpers/source-blocks';

const ADR = path.resolve(__dirname, '../../docs/adr/0006-vocabulary.md');

/** `@map` / `@@map` targets the ADR admits (rule 3 admits none). */
const ADMITTED_MAPS: ReadonlySet<string> = new Set<string>();

/**
 * Words the table bans unqualified for one concept while its own text names
 * a legitimate use for another, which the parser cannot read. Each entry
 * quotes the ADR. An entry here is a reading of the ADR, never a new
 * exception: a word the ADR does not already permit needs an ADR amendment.
 */
const ADR_ACKNOWLEDGED_USES: Readonly<Record<string, string>> = {
    Account: "User row: \"Account (NextAuth's `Account` is a sign-in provider link)\" — the NextAuth model of sub-phase 1.4.",
};

interface BannedWord {
    /** Lower-case words of the phrase, e.g. ['key', 'result']. */
    words: string[];
    /** The phrase as the ADR writes it. */
    text: string;
}

interface Vocabulary {
    rows: number;
    /** Banned everywhere in the schema. */
    strict: BannedWord[];
    /** Banned as a model or enum name only ("as a model"). */
    modelOnly: BannedWord[];
    /** Banned for one concept and correct for another; left to review. */
    contextDependent: string[];
}

/** Lower-case words of an identifier or phrase. */
function wordsOf(text: string): string[] {
    return text
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((w) => w.toLowerCase());
}

/** Split a table cell on commas and semicolons that are not inside parentheses. */
function splitCell(cell: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of cell) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if ((ch === ',' || ch === ';') && depth === 0) {
            out.push(cur);
            cur = '';
        } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim()).filter(Boolean);
}

/** Parse the ADR's vocabulary tables. */
function parseVocabulary(adr: string): Vocabulary {
    const start = adr.indexOf('### The vocabulary');
    const end = adr.indexOf('### Where code and UI differ');
    if (start < 0 || end < start) throw new Error('ADR 0006: vocabulary section not found');
    const rows = adr
        .slice(start, end)
        .split('\n')
        .filter((l) => l.startsWith('|') && !l.startsWith('|---') && !l.startsWith('| Term'))
        .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));

    // Every word the table uses as a NAME: terms, model names, UI labels.
    const named = new Set<string>();
    for (const [term = '', , model = '', ui = ''] of rows) {
        for (const w of wordsOf(term)) named.add(w);
        for (const id of model.match(/`[^`]+`/g) ?? []) for (const w of wordsOf(id)) named.add(w);
        for (const w of wordsOf(ui.replace(/\([^)]*\)/g, ''))) named.add(w);
    }

    const strict = new Map<string, BannedWord>();
    const modelOnly = new Map<string, BannedWord>();
    // key -> the ADR's spelling, and whether any occurrence is unqualified.
    const seen = new Map<string, { text: string; words: string[]; unqualified: boolean }>();

    for (const row of rows) {
        // "Login. Never "session" alone in code, …": only the first sentence lists words.
        const banned = (row[row.length - 1] ?? '').split(/\.\s/)[0]!;
        for (let entry of splitCell(banned)) {
            // "the spelling CANCELED"
            entry = entry.replace(/^the spelling\s+/i, '');
            const qualifier = /\(([^)]*)\)/.exec(entry)?.[1];
            const text = entry.replace(/\([^)]*\)/g, '').trim();
            if (!text) continue;
            // "P0–P3" stands for P0, P1, P2, P3.
            const range = /^P(\d)[–-]P(\d)$/.exec(text);
            const phrases = range
                ? Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => `P${Number(range[1]) + i}`)
                : [text];
            for (const phrase of phrases) {
                const words = wordsOf(phrase);
                const key = words.join(' ');
                if (qualifier && /as a model/i.test(qualifier)) {
                    modelOnly.set(key, { words, text: phrase });
                    continue;
                }
                const prior = seen.get(key);
                seen.set(key, { text: prior?.text ?? phrase, words, unqualified: (prior?.unqualified ?? false) || !qualifier });
            }
        }
    }

    const contextDependent = new Set<string>();
    for (const [, { text, words, unqualified }] of seen) {
        // Context-dependent: the table names a concept with this word, every
        // ban of it is qualified, or the ADR's text acknowledges another use.
        const namesAConcept = words.length === 1 && named.has(words[0]!);
        if (namesAConcept || !unqualified || text in ADR_ACKNOWLEDGED_USES) contextDependent.add(text);
        else strict.set(words.join(' '), { words, text });
    }

    return {
        rows: rows.length,
        strict: [...strict.values()],
        modelOnly: [...modelOnly.values()],
        contextDependent: [...contextDependent].sort(),
    };
}

interface Identifier {
    kind: 'model' | 'enum' | 'field' | 'value';
    name: string;
    where: string;
}

/** Every model, enum, field and enum value in a (comment-masked) schema. */
function schemaIdentifiers(schema: string): Identifier[] {
    const out: Identifier[] = [];
    for (const block of schema.matchAll(/^(model|enum)\s+(\w+)\s*\{([^}]*)\}/gm)) {
        const [, kind, name, body] = block as unknown as [string, 'model' | 'enum', string, string];
        out.push({ kind, name, where: name });
        for (const line of body.split('\n')) {
            const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\b/.exec(line);
            if (!m) continue;
            out.push({ kind: kind === 'model' ? 'field' : 'value', name: m[1]!, where: `${name}.${m[1]}` });
        }
    }
    return out;
}

/** Does `identifier`'s word sequence contain `banned` as a run of whole words (plural allowed)? */
function contains(identifier: string, banned: BannedWord): boolean {
    const words = wordsOf(identifier);
    const n = banned.words.length;
    for (let i = 0; i + n <= words.length; i++) {
        const run = words.slice(i, i + n);
        const last = run[n - 1]!;
        const lastMatches = last === banned.words[n - 1] || last === `${banned.words[n - 1]}s`;
        if (lastMatches && run.slice(0, n - 1).every((w, k) => w === banned.words[k])) return true;
    }
    return false;
}

function vocabularyViolations(schema: string, vocab: Vocabulary): string[] {
    const out: string[] = [];
    for (const id of schemaIdentifiers(schema)) {
        for (const b of vocab.strict) if (contains(id.name, b)) out.push(`${id.kind} ${id.where}: "${b.text}"`);
        if (id.kind === 'model' || id.kind === 'enum') {
            for (const b of vocab.modelOnly) if (contains(id.name, b)) out.push(`${id.kind} ${id.where}: "${b.text}" (as a model)`);
        }
    }
    return out;
}

function mapViolations(schema: string): string[] {
    return [...schema.matchAll(/(@@?map)\(\s*"([^"]*)"\s*\)/g)]
        .filter((m) => !ADMITTED_MAPS.has(m[2]!))
        .map((m) => `${m[1]}("${m[2]}")`);
}

const VOCABULARY = parseVocabulary(fs.readFileSync(ADR, 'utf8'));

describe('the schema speaks ADR 0006', () => {
    const schema = readPrismaSchema();

    it('(a) no @map or @@map renames a model, enum or column', () => {
        expect(mapViolations(schema)).toEqual([]);
    });

    it('(b) no model, enum, field or enum value uses a word the ADR bans', () => {
        expect(vocabularyViolations(schema, VOCABULARY)).toEqual([]);
    });

    it('reads the ADR table, and classifies the words it must', () => {
        // The denominator: a parser that read nothing would pass (b) over an
        // empty list.
        expect(VOCABULARY.rows).toBeGreaterThanOrEqual(50);
        const strict = VOCABULARY.strict.map((b) => b.text);
        expect(strict).toEqual(expect.arrayContaining(['Task', 'Issue', 'Ticket', 'Sprint', 'Employee', 'CANCELED', 'Key result']));
        expect(VOCABULARY.modelOnly.map((b) => b.text)).toEqual(expect.arrayContaining(['Dependency', 'Reply', 'Body']));
        // Banned for one concept, a name or a qualified use for another.
        expect(VOCABULARY.contextDependent).toEqual(expect.arrayContaining(['Owner', 'Status', 'Tenant', 'Agent', 'Account']));
        expect(strict.filter((w) => VOCABULARY.contextDependent.includes(w))).toEqual([]);
    });

    it('every ADR_ACKNOWLEDGED_USES entry is a word the ADR bans, and quotes the ADR verbatim', () => {
        const adr = fs.readFileSync(ADR, 'utf8');
        for (const [word, reason] of Object.entries(ADR_ACKNOWLEDGED_USES)) {
            expect(VOCABULARY.contextDependent).toContain(word);
            const quote = /"([^"]+)"/.exec(reason)?.[1];
            expect(quote).toBeDefined();
            expect(adr).toContain(quote);
        }
    });

    it('scans every model, enum, field and value in the schema', () => {
        const ids = schemaIdentifiers(schema);
        expect(ids.filter((i) => i.kind === 'model').map((i) => i.name).sort()).toEqual([
            'Account',
            'AuditLog',
            'AuditOutbox',
            'Comment',
            'CustomField',
            'CustomFieldOption',
            'CustomFieldValue',
            'Cycle',
            'CycleSchedule',
            'Goal',
            'Initiative',
            'IntakeBlockedSender',
            'IntakeFollowUp',
            'IntakeForm',
            'IntakeInboundEmail',
            'IntakeNotifyMember',
            'IntakeRequest',
            'Label',
            'Mention',
            'Milestone',
            'Notification',
            'NotificationOutbox',
            'NotificationPreference',
            'OrgAuditLog',
            'OrgInvite',
            'OrgMembership',
            'Organization',
            'PasswordResetToken',
            'Project',
            'ProjectIntake',
            'ProjectKeyPrefix',
            'ProjectKeySequence',
            'ProjectTemplate',
            'RecipientList',
            'RecipientListMember',
            'SavedView',
            'SearchVector',
            'Team',
            'Tenant',
            'TenantCustomRole',
            'TenantInvite',
            'TenantMembership',
            'TenantNotificationSettings',
            'TenantSecuritySettings',
            'User',
            'UserMfaEnrollment',
            'UserSession',
            'VerificationToken',
            'WorkItem',
            'WorkItemKeyAlias',
            'WorkItemLabel',
            'WorkItemLink',
            'WorkItemRecurrence',
            'WorkItemRelation',
            'WorkItemReviewRound',
            'WorkItemReviewStep',
            'WorkItemReviewStepList',
            'WorkItemReviewer',
            'WorkItemTemplate',
            'WorkItemTemplateLabel',
            'WorkItemTransition',
            'WorkItemType',
            'WorkItemTypeField',
            'WorkItemTypeReviewStep',
            'WorkItemTypeReviewStepReviewer',
            'WorkItemWatcher',
            'WorkflowState',
            'WorkingCalendar',
            'WorkingCalendarHoliday',
        ]);
        expect(ids.filter((i) => i.kind === 'enum').length).toBe(34);
        expect(ids).toEqual(expect.arrayContaining([{ kind: 'value', name: 'MEMBER', where: 'Role.MEMBER' }]));
    });
});

describe('the rules, against a planted schema', () => {
    const planted = codeOf(
        [
            'model Task {',
            '  id         String @id',
            '  sprintId   String',
            '  ownerId    String',
            '  passwordHash String',
            '  email      String @map("emailEncrypted")',
            '  // employee String  (a comment, not a field)',
            '  @@map("WorkItem")',
            '}',
            'model Dependency {',
            '  id   String @id',
            '  body String',
            '}',
            'enum WorkflowStateCategory {',
            '  STARTED',
            '  CANCELED',
            '}',
        ].join('\n'),
    );

    it('(a) reports both a field and a model @map', () => {
        expect(mapViolations(planted)).toEqual(['@map("emailEncrypted")', '@@map("WorkItem")']);
    });

    it('(b) reports the banned words, and not a context-dependent or partial match', () => {
        expect(vocabularyViolations(planted, VOCABULARY)).toEqual([
            'model Task: "Task"',
            'field Task.sprintId: "Sprint"',
            'model Dependency: "Dependency" (as a model)',
            'value WorkflowStateCategory.CANCELED: "CANCELED"',
        ]);
    });

    it('splits identifiers into whole words', () => {
        expect(wordsOf('provisionedByOrgId')).toEqual(['provisioned', 'by', 'org', 'id']);
        expect(wordsOf('ORG_READER')).toEqual(['org', 'reader']);
        expect(wordsOf('HTTPSServer')).toEqual(['https', 'server']);
        expect(contains('keyResults', { words: ['key', 'result'], text: 'Key result' })).toBe(true);
        expect(contains('passwordHash', { words: ['pass'], text: 'Pass' })).toBe(false);
    });
});
