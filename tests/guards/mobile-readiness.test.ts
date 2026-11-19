/**
 * The root layout declares the viewport (sub-phase 1.7): `device-width`,
 * `initialScale: 1`, and a `maximumScale` of 2 or more — never 1, which would
 * stop a reader zooming (WCAG 1.4.4). Next.js emits no default viewport meta.
 *
 * Copied from inflect-compliance's `tests/guards/mobile-readiness.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e; the read is bound to the
 * `viewport` declaration rather than the whole file.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { REPO_ROOT } from '../helpers/git-files';
import { codeOf } from '../helpers/source-blocks';

describe('mobile readiness baseline', () => {
    const layout = codeOf(fs.readFileSync(path.join(REPO_ROOT, 'src/app/layout.tsx'), 'utf8'));
    const block = layout.match(/export\s+const\s+viewport\s*:\s*Viewport\s*=\s*\{[^}]*\};/)?.[0] ?? '';

    it('the root layout exports a typed `viewport` object', () => {
        expect(block).not.toBe('');
    });

    it('sets width: device-width and initialScale: 1', () => {
        expect(block).toMatch(/width:\s*['"]device-width['"]/);
        expect(block).toMatch(/initialScale:\s*1\b/);
    });

    it('keeps pinch-zoom: maximumScale is 2 or more, never 1', () => {
        expect(block).not.toMatch(/maximumScale:\s*1\b/);
        expect(block).toMatch(/maximumScale:\s*[2-9]\b/);
    });
});
