/**
 * The release job's semantic-release and its Conventional Commits preset are
 * pinned as a pair (`.github/workflows/release.yml`).
 *
 * The preset renders its release notes through the changelog writer that
 * semantic-release's release-notes-generator bundles, and preset 10 needs
 * writer 9 while release-notes-generator 14 (semantic-release 25) bundles
 * writer 8. With that mismatch every release failed at `generateNotes`
 * ("Missing helper"), so no version was ever tagged (runs 15 to 25, fixed
 * 2026-11-20). The table below is the compatibility the pins were checked
 * against with a real `generateNotes` run; moving either pin to a major it
 * does not list fails here until the pair is checked again and added.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const RELEASE_YML = path.join(__dirname, '..', '..', '..', '.github', 'workflows', 'release.yml');

/** semantic-release major → the preset majors its bundled writer can render. */
const CHECKED_PAIRS: Readonly<Record<number, readonly number[]>> = {
    25: [9],
};

function pinnedMajor(source: string, pkg: string): number {
    const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = [...source.matchAll(new RegExp(`-p ${escaped}@(\\d+)\\.\\d+\\.\\d+\\b`, 'g'))];
    expect(matches).toHaveLength(1);
    return Number(matches[0]![1]);
}

describe('release tooling pins', () => {
    const source = fs.readFileSync(RELEASE_YML, 'utf8');

    it('pins semantic-release and the preset to exact versions, once each', () => {
        expect(pinnedMajor(source, 'semantic-release')).toBeGreaterThan(0);
        expect(pinnedMajor(source, 'conventional-changelog-conventionalcommits')).toBeGreaterThan(0);
    });

    it('pairs the preset with a major the bundled changelog writer renders', () => {
        const release = pinnedMajor(source, 'semantic-release');
        const preset = pinnedMajor(source, 'conventional-changelog-conventionalcommits');
        expect(CHECKED_PAIRS[release]).toBeDefined();
        expect(CHECKED_PAIRS[release]).toContain(preset);
    });
});
