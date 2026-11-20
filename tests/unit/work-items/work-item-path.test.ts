/**
 * `workItemPath` (2.2, used by every bell, mail and Activity link) names the
 * page 2.3 built, and the nav registries know it (the 2.3 map's risks 13 and
 * 14): the page file exists in git, it is a classified subpage with a
 * canonical parent, and the stepper names work items.
 */
import { STEPPER_ENTITIES } from '@/components/layout/entity-prev-next-nav';
import { resolveCanonicalParent } from '@/lib/nav/canonical-parents';
import { classifyRoute } from '@/lib/nav/page-segregation';
import { tenantWorkItemPath, workItemPath } from '@/lib/work-item-paths';

import { gitFiles, REPO_ROOT } from '../../helpers/git-files';

describe('the work-item page path', () => {
    it('points at a real page under the workspace shell', () => {
        expect(workItemPath('ISL-1')).toBe('/work-items/ISL-1');
        expect(gitFiles(REPO_ROOT)).toContain('src/app/t/[tenantSlug]/(app)/work-items/[workItemKey]/page.tsx');
        expect(gitFiles(REPO_ROOT)).toContain('src/app/t/[tenantSlug]/(app)/projects/[projectKey]/page.tsx');
    });

    it('is a subpage with a parent, and the stepper names it', () => {
        const path = tenantWorkItemPath('acme', 'ISL-1');
        expect(classifyRoute(path)).toBe('subpage');
        expect(resolveCanonicalParent(path, 'acme')).toEqual({ href: '/t/acme/work-items', label: 'Work items' });
        expect(resolveCanonicalParent('/t/acme/projects/ISL', 'acme')).toEqual({ href: '/t/acme/projects', label: 'Projects' });
        expect(STEPPER_ENTITIES.has('workItem')).toBe(true);
    });
});
