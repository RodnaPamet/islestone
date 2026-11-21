/**
 * PLAN_CHECKED_QUERIES (Hardening H2a; docs/porting/maps/H2.md part 1.2;
 * docs/performance.md): every named query whose plan the `perf` project
 * checks on the seeded database, and the repository methods each one runs.
 *
 * A repository method that reads `WorkItem`, `Comment` or `SearchVector` is
 * either named by a query here or carries a reason in `PLAN_CHECK_EXEMPT`
 * (`tests/guards/plan-checked-queries-coverage.test.ts`): a new list query
 * cannot avoid the check. `tests/perf/plans.test.ts` holds one runner per
 * name, and fails on a name without a runner or a runner without a name.
 *
 * Pure data (no imports), so the guard reads it without a database.
 *
 * `indexes`: each entry must be used by at least one of the query's
 * statements; `a|b` accepts either. `maxBuffers`: the shared buffers (hit
 * plus read) all its statements may touch on the 10k seed, so a plan that
 * uses the index but walks most of it is caught. Each budget is about twice
 * what H2a measured, closer where the count is fixed by the data (the locks
 * take every row they name) or held by a known finding; a budget only goes
 * down (docs/performance.md, "Plan checks"). At another shape the buffers
 * are reported, not judged: the 100k budgets arrive with the nightly (H2b).
 */

export interface PlanCheckedQuery {
    name: string;
    /** `Class.method` of every repository method the query runs. */
    methods: readonly string[];
    indexes: readonly string[];
    maxBuffers: number;
    /** Why no index is required, when `indexes` is empty (a reason, never "too hard"). */
    noIndexBecause?: string;
    /** Indexes that must be searched on their searched column (`IndexCondition` in plan-capture.ts). */
    conditions?: ReadonlyArray<{ index: string; operator: string }>;
    /**
     * A finding reported and not yet fixed (docs/performance.md, "Findings"):
     * the named check is held as FAILING (`it.failing`), so the fix turns the
     * suite red until this marker is removed and the check holds for good.
     */
    knownFinding?: { id: string; fails: 'conditions' | 'seqScans' };
}

/** Finding F1 (docs/performance.md): full-text and trigram conditions are filters under row-level security. */
const F1 = { id: 'F1', fails: 'conditions' } as const;

export const PLAN_CHECKED_QUERIES: readonly PlanCheckedQuery[] = [
    // ── The list, in each sort the API offers (one project) ───────────────
    { name: 'list: project, manual order', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_projectId_sortKey_id_idx'], maxBuffers: 700 },
    { name: 'list: project, by updated', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_projectId_updatedAt_id_idx'], maxBuffers: 500 },
    { name: 'list: project, by created', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_projectId_createdAt_id_idx'], maxBuffers: 500 },
    { name: 'list: project, by due date', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_projectId_dueDate_id_idx'], maxBuffers: 850 },
    { name: 'list: project, by priority', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_projectId_priorityRank_id_idx'], maxBuffers: 750 },
    { name: 'list: project, by key', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_projectId_number_key'], maxBuffers: 1000 },
    { name: 'list: project, second page (keyset)', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_projectId_sortKey_id_idx'], maxBuffers: 1500 },
    // ── The Work items page: workspace-wide, two filters, by due date ─────
    { name: 'list: workspace, manual order', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_sortKey_id_idx'], maxBuffers: 850 },
    { name: 'list: workspace, two filters, by due date', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_dueDate_id_idx'], maxBuffers: 2600 },
    { name: 'list: project, label filter', methods: ['WorkItemRepository.list'], indexes: ['WorkItemLabel_tenantId_labelId_workItemId_idx'], maxBuffers: 1100 },
    { name: 'list: project, custom-field filter', methods: ['WorkItemRepository.list'], indexes: ['CustomFieldValue_tenantId_fieldId_optionId_idx'], maxBuffers: 2100 },
    { name: 'list: project, sorted by a custom field', methods: ['WorkItemRepository.listByCustomField'], indexes: ['CustomFieldValue_tenantId_fieldId_optionId_idx'], maxBuffers: 5500 },
    { name: 'list: q (titles, stemmed titles, contents)', methods: ['WorkItemRepository.titleFullTextIds', 'SearchVectorRepository.matchItems', 'WorkItemRepository.list'], indexes: ['WorkItem_search_title_fts'], maxBuffers: 20000, conditions: [{ index: 'WorkItem_search_title_fts', operator: '@@' }, { index: 'SearchVector_search_lexemes', operator: '@@' }, { index: 'WorkItem_search_title_trgm', operator: '~~*' }], knownFinding: F1 },
    { name: 'list: the Deleted view', methods: ['WorkItemRepository.listDeleted'], indexes: ['WorkItem_tenantId_deletionId_idx|WorkItem_deletedAt_idx'], maxBuffers: 1800 },
    // ── The board: one column of the large project ────────────────────────
    { name: 'board: one column (by state)', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_projectId_stateId_sortKey_idx'], maxBuffers: 800 },
    // ── My Work's six sections ─────────────────────────────────────────────
    {
        name: 'my work: to review',
        methods: ['WorkItemRepository.list'],
        indexes: [],
        noIndexBecause: 'the seed holds review rounds only in the 1 % sample (about twenty steps per workspace), so the planner rightly reads the reviewer tables whole; the shape gains bulk reviews with 2.8\'s volume (docs/performance.md, "What the seed leaves out")',
        maxBuffers: 200,
    },
    { name: 'my work: assigned', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_assigneeId_sortKey_id_idx'], maxBuffers: 1000 },
    { name: 'my work: waiting on me', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_waitingOnUserId_stateCategory_dueDate_idx'], maxBuffers: 200 },
    { name: 'my work: created', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_createdByUserId_createdAt_idx'], maxBuffers: 1400 },
    { name: 'my work: watching', methods: ['WorkItemRepository.list'], indexes: ['WorkItemWatcher_tenantId_userId_idx'], maxBuffers: 1600 },
    { name: 'my work: due soon', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_assigneeId_stateCategory_dueDate_idx|WorkItem_tenantId_assigneeId_sortKey_id_idx'], maxBuffers: 1600 },
    // ── The detail and what the sheet loads beside it ──────────────────────
    { name: 'detail: the item', methods: ['WorkItemRepository.getById'], indexes: ['WorkItem_pkey|WorkItem_id_tenantId_key|WorkItem_id_projectId_tenantId_key'], maxBuffers: 100 },
    { name: 'detail: comments', methods: ['CommentRepository.list'], indexes: ['Comment_tenantId_workItemId_createdAt_idx'], maxBuffers: 100 },
    { name: 'detail: sub-items and their progress', methods: ['WorkItemRepository.listSubItems', 'WorkItemRepository.subItemProgress'], indexes: ['WorkItem_tenantId_parentId_sortKey_idx'], maxBuffers: 100 },
    { name: 'detail: the subtree and ancestors', methods: ['WorkItemRepository.liveSubtree', 'WorkItemRepository.subtreeHeight', 'WorkItemRepository.ancestors'], indexes: ['WorkItem_tenantId_parentId_sortKey_idx'], maxBuffers: 150 },
    // ── Counts: metrics, cycles, milestones ────────────────────────────────
    { name: 'counts: list metrics (one project)', methods: ['WorkItemRepository.metrics'], indexes: ['WorkItem_tenantId_projectId_sortKey_id_idx|WorkItem_tenantId_projectId_stateId_sortKey_idx|WorkItem_tenantId_projectId_dueDate_id_idx'], maxBuffers: 1400 },
    { name: 'counts: cycles', methods: ['WorkItemRepository.countsByCycle', 'WorkItemRepository.cycleIdsInUse'], indexes: ['WorkItem_tenantId_cycleId_stateCategory_idx'], maxBuffers: 1100 },
    { name: 'counts: milestones', methods: ['WorkItemRepository.countsByMilestone'], indexes: ['WorkItem_tenantId_milestoneId_stateCategory_idx'], maxBuffers: 250 },
    { name: 'counts: items in a state', methods: ['TeamRepository.countItemsInState', 'ReviewRepository.itemsInStateRequiringReview', 'WorkItemRepository.lockInState'], indexes: ['WorkItem_tenantId_stateId_idx'], maxBuffers: 6500 },
    // ── Search: the palette's raw reads ────────────────────────────────────
    { name: 'search: titles (trigram and full text)', methods: ['WorkItemRepository.searchTitles'], indexes: ['WorkItem_search_title_fts|WorkItem_search_title_trgm'], maxBuffers: 2500, conditions: [{ index: 'WorkItem_search_title_trgm', operator: '~~*' }, { index: 'WorkItem_search_title_fts', operator: '@@' }], knownFinding: F1 },
    { name: 'search: contents and snippets', methods: ['SearchVectorRepository.matchItems', 'WorkItemRepository.findSearchRows', 'WorkItemRepository.searchSnippetSources'], indexes: [], noIndexBecause: 'finding F1: under row-level security the lexemes index is read on tenantId alone or not at all (at 100k the planner walks every item instead); its condition is the failing check', maxBuffers: 18000, conditions: [{ index: 'SearchVector_search_lexemes', operator: '@@' }], knownFinding: F1 },
    // ── The timeline (3.1b) and the calendars it reads (3.1a) ──────────────
    { name: 'timeline: scope, count and relations', methods: ['WorkItemRepository.listForTimeline', 'WorkItemRepository.countForTimeline', 'WorkItemRepository.timelineContextRows'], indexes: ['WorkItem_tenantId_projectId_sortKey_id_idx'], maxBuffers: 1200 },
    {
        name: 'timeline: working calendars',
        methods: [],
        indexes: [],
        noIndexBecause: 'a workspace holds one calendar per team and its holidays (at most 500 each): a sequential scan of a few pages is the cheapest plan at every workspace size; the budget holds it small',
        maxBuffers: 100,
    },
    // ── Writes' reads: placement, moves, a member's removal ────────────────
    { name: 'placement: sort keys around a position', methods: ['WorkItemRepository.lastSortKey', 'WorkItemRepository.nextSortKeyAfter', 'WorkItemRepository.prevSortKeyBefore'], indexes: ['WorkItem_tenantId_projectId_sortKey_id_idx'], maxBuffers: 100 },
    { name: 'removal: a member\'s items', methods: ['WorkItemRepository.lockItemsOfPerson'], indexes: ['WorkItem_tenantId_assigneeId_stateCategory_dueDate_idx|WorkItem_tenantId_assigneeId_sortKey_id_idx', 'WorkItem_tenantId_waitingOnUserId_stateCategory_dueDate_idx', 'CustomFieldValue_tenantId_userId_idx|CustomFieldValue_tenantId_fieldId_userId_idx'], maxBuffers: 7500 },
    { name: 'deletion: a deletion group', methods: ['WorkItemRepository.idsOfDeletion'], indexes: ['WorkItem_tenantId_deletionId_idx'], maxBuffers: 100 },
    { name: 'cycle and milestone deletes: their items', methods: ['WorkItemRepository.idsInCycleIncludingDeleted', 'WorkItemRepository.idsInMilestoneIncludingDeleted', 'WorkItemRepository.rolloverCandidates'], indexes: ['WorkItem_tenantId_cycleId_stateCategory_idx', 'WorkItem_tenantId_milestoneId_stateCategory_idx'], maxBuffers: 2400 },
    { name: 'templates: open items of a project', methods: ['WorkItemRepository.openItemsForTemplate'], indexes: ['WorkItem_tenantId_parentId_sortKey_idx|WorkItem_tenantId_projectId_sortKey_id_idx'], maxBuffers: 1700 },
    // ── Jobs: reminders, the digest, the purge, the rebalance, the rebuild ─
    { name: 'job: due reminders', methods: ['WorkItemRepository.dueCandidates'], indexes: ['WorkItem_tenantId_stateCategory_dueDate_idx|WorkItem_tenantId_projectId_dueDate_id_idx|WorkItem_tenantId_dueDate_id_idx'], maxBuffers: 150 },
    { name: 'job: the daily digest', methods: ['WorkItemRepository.digestDueItems'], indexes: ['WorkItem_tenantId_assigneeId_stateCategory_dueDate_idx|WorkItem_tenantId_dueDate_id_idx'], maxBuffers: 1100 },
    { name: 'job: the purge sweep', methods: ['WorkItemRepository.purgeableIds'], indexes: ['WorkItem_deletedAt_idx'], maxBuffers: 150 },
    { name: 'job: a purged project', methods: ['WorkItemRepository.countLiveInProject', 'WorkItemRepository.projectItemIds'], indexes: ['WorkItem_tenantId_projectId_sortKey_id_idx|WorkItem_tenantId_projectId_number_key|WorkItem_tenantId_projectId_createdAt_id_idx'], maxBuffers: 400 },
    { name: 'job: the sort-key rebalance', methods: ['WorkItemRepository.projectsNeedingRebalance', 'WorkItemRepository.orderedPage'], indexes: ['WorkItem_tenantId_projectId_sortKey_id_idx'], maxBuffers: 500 },
    { name: 'job: the search-index rebuild', methods: ['SearchVectorRepository.staleDescriptionPage', 'SearchVectorRepository.staleCommentPage'], indexes: [], noIndexBecause: 'finding F2: the stale-page reads hash-join every source of the workspace (docs/performance.md)', maxBuffers: 15000, knownFinding: { id: 'F2', fails: 'seqScans' } },
];

/**
 * Repository methods that read a guarded table and are not plan-checked,
 * each with its reason. A reason is a fact about the query's shape, never
 * "too hard to set up".
 */
export const PLAN_CHECK_EXEMPT: Readonly<Record<string, string>> = {
    'WorkItemRepository.findVisible': 'one item by primary key (the write gate)',
    'WorkItemRepository.findDeletedForRestore': 'one item by primary key',
    'WorkItemRepository.lockForWrite': 'the given ids by primary key, locked in id order (decision 173)',
    'WorkItemRepository.lockPurgeBatch': 'a purge batch\'s ids by primary key and the rows naming them as parent',
    'WorkItemRepository.listByIds': 'the given ids by primary key (a bounded bulk selection)',
    'WorkItemRepository.sortKeysOf': 'the given ids by primary key',
    'WorkItemRepository.deletedOutside': 'the given ids by primary key',
    'WorkItemRepository.recurrenceSource': 'one item by primary key',
    'WorkItemRepository.occurrenceExists': 'one row by the partial unique (recurrenceId, occurrenceOn)',
    'WorkItemRepository.listForFanOut': 'the given ids by primary key',
    'WorkItemRepository.findByNumber': 'one item by the unique (tenantId, projectId, number)',
    'WorkItemRepository.liveForDigest': 'the given ids by primary key',
    'WorkItemRelationRepository.visibleIds': 'the given ids by primary key',
    'CommentRepository.get': 'one comment by primary key',
    'CommentRepository.getWithBody': 'one comment by primary key',
    'ReviewRepository.lockItem': 'one item by primary key, locked',
    'ReviewRepository.lockItems': 'the given ids by primary key, locked in id order',
    'SearchVectorRepository.descriptionTexts': 'one rebuild page of ids by primary key',
    'SearchVectorRepository.commentTexts': 'one rebuild page of ids by primary key',
};
