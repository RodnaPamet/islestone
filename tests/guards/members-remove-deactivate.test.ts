/**
 * Members admin — remove/deactivate actions (structural ratchet).
 *
 *   1. A hard-remove usecase + DELETE route exist (only soft-deactivate did).
 *
 * Copied from inflect-compliance at 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 * Its page halves (the bulk action row, the row menu) and the bg.json parity
 * check are not ported: the members admin page arrives with the admin shell
 * (1.7, docs/porting/maps/1.4.md), and Islestone is English-only.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const USECASE = 'src/app-layer/usecases/tenant-admin.ts';
const ROUTE = 'src/app/api/t/[tenantSlug]/admin/members/[membershipId]/route.ts';

describe('members remove/deactivate (1) hard-remove backend', () => {
    it('removeTenantMember usecase enforces self + last-OWNER protection', () => {
        const src = read(USECASE);
        expect(src).toMatch(/export async function removeTenantMember/);
        expect(src).toMatch(/tenantMembership\.delete/);
        expect(src).toMatch(/Cannot remove your own membership/);
        expect(src).toMatch(/Cannot remove the last OWNER/);
    });
    it('a DELETE route is wired to removeTenantMember behind admin.members', () => {
        const src = read(ROUTE);
        expect(src).toMatch(/export const DELETE/);
        expect(src).toMatch(/removeTenantMember/);
        expect(src).toMatch(/requirePermission<[^>]*>\(\s*'admin\.members'/);
    });
});
