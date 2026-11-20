/**
 * The document lock (src/app/globals.css): at md+ the document is the
 * viewport's height with overflow hidden, so the shell's `md:h-full`
 * (AppShellFrame) holds and every page scrolls in its own container.
 *
 * Without it the shell grew to its content and the window scrolled: on a
 * project page whose header wrapped (2.7e's "Recipient lists" link, in
 * CI's fonts) the board's columns ran below the fold, and a pointer drag
 * that had to scroll the window lost its drop (the work-items e2e). The
 * stylesheet is compiled through the real postcss chain
 * (`tests/helpers/compile-globals-css.mjs`), because which layer the rule
 * lands in is part of what is held: inside a layer, a utility could undo it.
 *
 * Written fresh for Islestone; the rule is inflect-compliance's
 * (PROVENANCE.md).
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import postcss, { type AtRule, type Rule } from 'postcss';

const ROOT = path.resolve(__dirname, '../..');

function declsOf(rule: Rule): Record<string, string> {
    const out: Record<string, string> = {};
    rule.walkDecls((d) => {
        out[d.prop] = `${d.value}${d.important ? ' !important' : ''}`;
    });
    return out;
}

function documentRules(root: postcss.Root, media: RegExp): Array<{ rule: Rule; layered: boolean }> {
    const found: Array<{ rule: Rule; layered: boolean }> = [];
    root.walkAtRules('media', (at: AtRule) => {
        if (!media.test(at.params)) return;
        at.walkRules((rule) => {
            const selectors = rule.selectors.map((s) => s.trim());
            if (!selectors.includes('html') || !selectors.includes('body')) return;
            let layered = false;
            for (let p: postcss.Node | undefined = at.parent as postcss.Node | undefined; p; p = p.parent as postcss.Node | undefined) {
                if (p.type === 'atrule' && (p as AtRule).name === 'layer') layered = true;
            }
            found.push({ rule, layered });
        });
    });
    return found;
}

describe('the document lock', () => {
    let root: postcss.Root;

    beforeAll(() => {
        const css = execFileSync(process.execPath, [path.join(ROOT, 'tests/helpers/compile-globals-css.mjs')], {
            cwd: ROOT,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
        });
        root = postcss.parse(css);
    }, 180_000);

    it('locks html and body to the viewport at md and up, outside every layer', () => {
        const rules = documentRules(root, /min-width:\s*768px|width\s*>=\s*768px/);
        expect(rules).toHaveLength(1);
        expect(rules[0]!.layered).toBe(false);
        expect(declsOf(rules[0]!.rule)).toMatchObject({ height: '100%', overflow: 'hidden' });
    });

    it('releases it for print', () => {
        const rules = documentRules(root, /^print$/);
        expect(rules).toHaveLength(1);
        expect(declsOf(rules[0]!.rule)).toMatchObject({ height: 'auto !important', overflow: 'visible !important' });
    });

    it('the shell still leans on it (md:h-full on the frame)', () => {
        const frame = fs.readFileSync(path.join(ROOT, 'src/components/layout/AppShellFrame.tsx'), 'utf8');
        expect(frame).toMatch(/className="min-h-screen md:h-full md:overflow-hidden flex"/);
    });
});
