/**
 * The work-item gates and project visibility.
 *
 * The granular semantics ("tighten, never loosen"; a partial granular object
 * fails closed) follow inflect-compliance's
 * `tests/unit/task-policies-assign-comment.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e. Project visibility is
 * Islestone's (roadmap H2): every live project for OWNER, ADMIN, MEMBER and
 * VIEWER; none for GUEST until 8.4's grants; an unknown role fails closed.
 */
import type { Role } from '@prisma/client';

import {
    assertCanAssignWorkItems,
    assertCanCommentOnWorkItems,
    assertCanCreateWorkItem,
    assertCanDeleteWorkItems,
    assertCanEditWorkItems,
    assertCanReadWorkItems,
} from '@/app-layer/policies/work-item.policies';
import {
    assertCanArchiveProject,
    assertCanCreateProject,
    assertCanEditProject,
    assertCanManageWorkConfig,
    assertCanReadWorkConfig,
    mayArchiveProject,
    mayCreateProject,
    mayEditProject,
    mayManageWorkConfig,
    mayReadWorkConfig,
    workConfigAffordances,
} from '@/app-layer/policies/work-config.policies';
import { commentAffordances, commentDeleteBasis, isMarkedAnswer, mayEditComment } from '@/app-layer/policies/comment.policies';
import {
    JOB_PROJECT_VISIBILITY_WHERE,
    projectRowVisibilityWhere,
    projectVisibilityWhere,
    resolveProjectVisibility,
} from '@/app-layer/policies/project-visibility';
import { getPermissionsForRole } from '@/lib/permissions';

import { makeRequestContext } from '../../helpers/make-context';

const ROLES: Role[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST'];
const passes = (fn: () => void) => {
    try {
        fn();
        return true;
    } catch {
        return false;
    }
};

describe('work-item gates by built-in role', () => {
    const matrix = Object.fromEntries(
        ROLES.map((role) => {
            const ctx = makeRequestContext(role);
            return [
                role,
                {
                    read: passes(() => assertCanReadWorkItems(ctx)),
                    create: passes(() => assertCanCreateWorkItem(ctx)),
                    edit: passes(() => assertCanEditWorkItems(ctx)),
                    assign: passes(() => assertCanAssignWorkItems(ctx)),
                    comment: passes(() => assertCanCommentOnWorkItems(ctx)),
                    delete: passes(() => assertCanDeleteWorkItems(ctx)),
                },
            ];
        }),
    );

    it('matches the 1.4 role matrix (delete for OWNER and ADMIN only)', () => {
        expect(matrix).toEqual({
            OWNER: { read: true, create: true, edit: true, assign: true, comment: true, delete: true },
            ADMIN: { read: true, create: true, edit: true, assign: true, comment: true, delete: true },
            MEMBER: { read: true, create: true, edit: true, assign: true, comment: true, delete: false },
            VIEWER: { read: true, create: false, edit: false, assign: false, comment: false, delete: false },
            // Decision 204: a GUEST holds no key until 8.4, so every gate refuses it.
            GUEST: { read: false, create: false, edit: false, assign: false, comment: false, delete: false },
        });
    });

    it('a custom role that withholds a key is refused although the coarse tier passes (tighten, never loosen)', () => {
        const perms = getPermissionsForRole('MEMBER');
        perms.work_items.assign = false;
        const ctx = makeRequestContext('MEMBER', { appPermissions: perms });
        expect(() => assertCanAssignWorkItems(ctx)).toThrow(expect.objectContaining({ status: 403 }));
        expect(() => assertCanEditWorkItems(ctx)).not.toThrow();
    });

    it('a present but partial granular layer fails closed', () => {
        const ctx = makeRequestContext('OWNER', { appPermissions: { workspace: { view: true } } as never });
        expect(() => assertCanReadWorkItems(ctx)).toThrow();
        expect(() => assertCanCommentOnWorkItems(ctx)).toThrow();
    });

    it('with no granular layer at all, the coarse tier stands in', () => {
        const ctx = makeRequestContext('MEMBER', { appPermissions: undefined as never });
        expect(() => assertCanEditWorkItems(ctx)).not.toThrow();
        expect(() => assertCanCommentOnWorkItems(ctx)).not.toThrow();
    });
});

describe('work configuration gates', () => {
    it('reads for every workspace-wide role (never a GUEST, decision 204), changes for OWNER and ADMIN, projects by their own keys', () => {
        const row = (role: Role) => {
            const ctx = makeRequestContext(role);
            return [
                passes(() => assertCanReadWorkConfig(ctx)),
                passes(() => assertCanManageWorkConfig(ctx)),
                passes(() => assertCanCreateProject(ctx)),
                passes(() => assertCanEditProject(ctx)),
                passes(() => assertCanArchiveProject(ctx)),
            ];
        };
        expect(Object.fromEntries(ROLES.map((r) => [r, row(r)]))).toEqual({
            OWNER: [true, true, true, true, true],
            ADMIN: [true, true, true, true, true],
            MEMBER: [true, false, true, true, false],
            VIEWER: [true, false, false, false, false],
            GUEST: [false, false, false, false, false],
        });
    });
});

describe('the Settings affordances (decision 55)', () => {
    it('each predicate answers exactly what its assertion admits, for every role', () => {
        for (const role of ROLES) {
            const ctx = makeRequestContext(role);
            expect(mayReadWorkConfig(ctx)).toBe(passes(() => assertCanReadWorkConfig(ctx)));
            expect(mayManageWorkConfig(ctx)).toBe(passes(() => assertCanManageWorkConfig(ctx)));
            expect(mayCreateProject(ctx)).toBe(passes(() => assertCanCreateProject(ctx)));
            expect(mayEditProject(ctx)).toBe(passes(() => assertCanEditProject(ctx)));
            expect(mayArchiveProject(ctx)).toBe(passes(() => assertCanArchiveProject(ctx)));
        }
    });

    it('offers an OWNER and an ADMIN every write', () => {
        for (const role of ['OWNER', 'ADMIN'] as Role[]) {
            expect(workConfigAffordances(makeRequestContext(role))).toEqual({
                manageWorkConfig: true,
                createProject: true,
                editProject: true,
                archiveProject: true,
                manageCustomFields: true,
            });
        }
    });

    it('an Admin whose custom role withholds admin.manage and projects.archive is offered neither', () => {
        const perms = getPermissionsForRole('ADMIN');
        perms.admin.manage = false;
        perms.projects.archive = false;
        const ctx = makeRequestContext('ADMIN', { appPermissions: perms });
        expect(workConfigAffordances(ctx)).toEqual({ manageWorkConfig: false, createProject: true, editProject: true, archiveProject: false, manageCustomFields: true });
        expect(() => assertCanManageWorkConfig(ctx)).toThrow(expect.objectContaining({ status: 403 }));
    });
});

describe('project visibility', () => {
    it('OWNER, ADMIN, MEMBER and VIEWER see every live project; GUEST sees none until 8.4', () => {
        for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as Role[]) {
            expect(resolveProjectVisibility({ role, membershipRole: role })).toEqual({ kind: 'ALL' });
        }
        expect(resolveProjectVisibility({ role: 'GUEST', membershipRole: 'GUEST' })).toEqual({ kind: 'GRANTED', projectIds: [] });
    });

    it('fails closed: an unknown role, or a GUEST membership behind a custom role, gets no project', () => {
        expect(resolveProjectVisibility({ role: 'SUPERUSER' as Role })).toEqual({ kind: 'GRANTED', projectIds: [] });
        expect(resolveProjectVisibility({ role: 'MEMBER', membershipRole: 'GUEST' })).toEqual({ kind: 'GRANTED', projectIds: [] });
    });

    it('the fragment hides deleted projects always, archived ones unless asked, and narrows a grant', () => {
        expect(projectVisibilityWhere({ kind: 'ALL' })).toEqual({ project: { deletedAt: null, archivedAt: null } });
        expect(projectVisibilityWhere({ kind: 'ALL' }, { includeArchived: true })).toEqual({ project: { deletedAt: null } });
        expect(projectVisibilityWhere({ kind: 'GRANTED', projectIds: ['p1'] })).toEqual({
            project: { deletedAt: null, archivedAt: null },
            projectId: { in: ['p1'] },
        });
        expect(projectRowVisibilityWhere({ kind: 'GRANTED', projectIds: [] })).toEqual({ deletedAt: null, archivedAt: null, id: { in: [] } });
        expect(JOB_PROJECT_VISIBILITY_WHERE).toEqual({ project: { deletedAt: null, archivedAt: null } });
    });
});

describe('comments (owner decision, 2026-11-19)', () => {
    const author = { authorUserId: 'author-1' };

    it('only the author edits; an admin never rewrites someone else\'s words', () => {
        expect(mayEditComment(makeRequestContext('MEMBER', { userId: 'author-1' }), author)).toBe(true);
        expect(mayEditComment(makeRequestContext('OWNER', { userId: 'admin-1' }), author)).toBe(false);
        expect(mayEditComment(makeRequestContext('ADMIN', { userId: 'admin-1' }), author)).toBe(false);
    });

    it('the author deletes as the author; an admin deletes as moderation; anyone else may not', () => {
        expect(commentDeleteBasis(makeRequestContext('MEMBER', { userId: 'author-1' }), author)).toBe('author');
        expect(commentDeleteBasis(makeRequestContext('ADMIN', { userId: 'admin-1' }), author)).toBe('moderation');
        expect(commentDeleteBasis(makeRequestContext('MEMBER', { userId: 'other-1' }), author)).toBeNull();
    });
});

describe('the marked answer (2.4b-c, decisions 113 and 118)', () => {
    const comment = { id: 'c-1', authorUserId: 'author-1' };
    const answered = { answerCommentId: 'c-1' };
    const open = { mayEditItem: true, answerShown: true };

    it('locks the marked answer: neither its author nor an admin edits or deletes it until the answer is cleared', () => {
        expect(isMarkedAnswer(comment, answered)).toBe(true);
        expect(isMarkedAnswer(comment, { answerCommentId: 'c-2' })).toBe(false);
        expect(isMarkedAnswer(comment, { answerCommentId: null })).toBe(false);
        const asAuthor = commentAffordances(makeRequestContext('MEMBER', { userId: 'author-1' }), comment, answered, open);
        expect(asAuthor).toEqual({ edit: false, deleteBasis: null, isAnswer: true, markAnswer: false });
        const asAdmin = commentAffordances(makeRequestContext('ADMIN', { userId: 'admin-1' }), comment, answered, open);
        expect(asAdmin.deleteBasis).toBeNull();
        // Cleared, the ordinary rules return.
        const cleared = commentAffordances(makeRequestContext('ADMIN', { userId: 'admin-1' }), comment, { answerCommentId: null }, open);
        expect(cleared).toEqual({ edit: false, deleteBasis: 'moderation', isAnswer: false, markAnswer: true });
    });

    it('offers "Mark as answer" only to someone who may edit the item, where the field set shows the answer', () => {
        const ctx = makeRequestContext('MEMBER', { userId: 'other-1' });
        expect(commentAffordances(ctx, comment, {}, open).markAnswer).toBe(true);
        expect(commentAffordances(ctx, comment, {}, { mayEditItem: false, answerShown: true }).markAnswer).toBe(false);
        expect(commentAffordances(ctx, comment, {}, { mayEditItem: true, answerShown: false }).markAnswer).toBe(false);
    });
});
