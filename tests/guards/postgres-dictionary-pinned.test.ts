/**
 * The Bulgarian dictionary in Islestone's Postgres image is the file set ADR
 * 0007 E10 admits, and nothing else (sub-phase 2.7f; owner decisions 145 and
 * 146).
 *
 * The licence gate (`scripts/licence-gate.mjs`) reads npm packages; the
 * dictionary is data copied into an image, so this guard holds it instead:
 *
 *   - every file git lists in `deploy/postgres/tsearch_data/` is recorded in
 *     `deploy/postgres/dictionary.json`, and every recorded file exists, with
 *     the recorded sha256 (`null`: our own README, listed but not pinned);
 *   - the record's archive digest, source hashes, result hashes and licence
 *     are the ones ADR 0007 E10 states, and that ADR is Accepted;
 *   - `deploy/postgres/Dockerfile` checks the same two hashes before it
 *     installs the files.
 *
 * Changing the dictionary is therefore an amendment to ADR 0007, never a file
 * swap. The drift detector proves itself against a planted repository.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';

const DIR = 'deploy/postgres/tsearch_data/';
const RECORD = 'deploy/postgres/dictionary.json';
const ADR = 'docs/adr/0007-third-party-licence-exceptions.md';
const DOCKERFILE = 'deploy/postgres/Dockerfile';

interface DictionaryRecord {
    licence: string;
    upstreamLicence: string;
    adr: string;
    adrSection: string;
    copyright: string;
    archive: { url: string; sha512: string };
    sources: Record<string, string>;
    files: Record<string, string | null>;
}

const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Differences between the files git lists under the directory and the record. */
function drift(root: string): string[] {
    const record = JSON.parse(fs.readFileSync(path.join(root, RECORD), 'utf8')) as DictionaryRecord;
    const listed = gitFiles(root).filter((rel) => rel.startsWith(DIR)).map((rel) => rel.slice(DIR.length));
    const out: string[] = [];
    for (const name of listed) if (!(name in record.files)) out.push(`unrecorded file: ${name}`);
    for (const [name, hash] of Object.entries(record.files)) {
        if (!listed.includes(name)) {
            out.push(`recorded but missing: ${name}`);
            continue;
        }
        if (hash !== null && sha256(path.join(root, DIR, name)) !== hash) out.push(`hash differs: ${name}`);
    }
    return out;
}

/** The E10 section of ADR 0007. */
function e10(): string {
    const adr = fs.readFileSync(path.join(REPO_ROOT, ADR), 'utf8');
    const start = adr.indexOf('### E10');
    const end = adr.indexOf('\n## ', start);
    return start === -1 ? '' : adr.slice(start, end === -1 ? undefined : end);
}

describe('the Bulgarian dictionary is pinned to ADR 0007 E10', () => {
    const record = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, RECORD), 'utf8')) as DictionaryRecord;

    it('every file in tsearch_data/ is recorded, present and unchanged', () => {
        expect(drift(REPO_ROOT)).toEqual([]);
    });

    it('the dictionary files themselves are pinned (not just listed)', () => {
        expect(record.files['bulgarian.dict']).toMatch(/^[0-9a-f]{64}$/);
        expect(record.files['bulgarian.affix']).toMatch(/^[0-9a-f]{64}$/);
    });

    it('the record cites ADR 0007 E10, which is Accepted', () => {
        expect(record.adr).toBe(ADR);
        expect(record.adrSection).toBe('E10');
        const adr = fs.readFileSync(path.join(REPO_ROOT, ADR), 'utf8');
        expect(adr.split('\n')[2]).toMatch(/^Status: Accepted\b/);
        expect(e10()).not.toBe('');
    });

    it('E10 states every hash, the archive digest and the licence the record holds', () => {
        const section = e10();
        expect(record.licence).toBe('MPL-2.0');
        expect(record.upstreamLicence).toBe('GPL-2.0-or-later OR LGPL-2.1-or-later OR MPL-1.1');
        expect(section).toContain(record.upstreamLicence);
        expect(section).toContain('MPL-2.0');
        expect(section).toContain(record.archive.sha512);
        expect(section).toContain(record.copyright.replace('Copyright (C) ', ''));
        for (const hash of Object.values(record.sources)) expect(section).toContain(hash);
        expect(section).toContain(record.files['bulgarian.dict']);
        expect(section).toContain(record.files['bulgarian.affix']);
    });

    it('the Dockerfile checks the same two hashes before installing them', () => {
        const dockerfile = fs.readFileSync(path.join(REPO_ROOT, DOCKERFILE), 'utf8');
        expect(dockerfile).toContain(`${record.files['bulgarian.dict']} bulgarian.dict`);
        expect(dockerfile).toContain(`${record.files['bulgarian.affix']} bulgarian.affix`);
        expect(dockerfile).toMatch(/sha256sum -c -/);
        // The licence and the statement of change travel with the files.
        expect(dockerfile).toMatch(/COPY tsearch_data\/LICENSE-MPL-2\.0\.txt tsearch_data\/Copyright_spell\.txt tsearch_data\/README\.md /);
    });

    it('NOTICE and PROVENANCE.md carry it', () => {
        const notice = fs.readFileSync(path.join(REPO_ROOT, 'NOTICE'), 'utf8');
        const provenance = fs.readFileSync(path.join(REPO_ROOT, 'PROVENANCE.md'), 'utf8');
        expect(notice).toContain(record.copyright);
        expect(notice).toContain('Mozilla Public License');
        expect(provenance).toContain(record.archive.sha512);
    });
});

describe('the drift detector, against a planted repository', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-dictionary-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        fs.mkdirSync(path.join(root, DIR), { recursive: true });
        for (const name of ['bulgarian.dict', 'bulgarian.affix', 'README.md']) {
            fs.writeFileSync(path.join(root, DIR, name), `${name}\n`);
        }
        const files = {
            'bulgarian.dict': sha256(path.join(root, DIR, 'bulgarian.dict')),
            'bulgarian.affix': sha256(path.join(root, DIR, 'bulgarian.affix')),
            'README.md': null,
        };
        fs.writeFileSync(path.join(root, RECORD), JSON.stringify({ files }));
    });

    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('passes the planted set as recorded', () => {
        expect(drift(root)).toEqual([]);
    });

    it('flags a changed, an added and a removed file', () => {
        fs.appendFileSync(path.join(root, DIR, 'bulgarian.dict'), 'нова дума\n');
        fs.writeFileSync(path.join(root, DIR, 'extra.dict'), 'x\n');
        fs.rmSync(path.join(root, DIR, 'bulgarian.affix'));
        expect(drift(root).sort()).toEqual(['hash differs: bulgarian.dict', 'recorded but missing: bulgarian.affix', 'unrecorded file: extra.dict']);
    });
});
