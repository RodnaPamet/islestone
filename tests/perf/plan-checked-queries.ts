/**
 * PLAN_CHECKED_QUERIES (Hardening H2a; docs/porting/maps/H2.md part 1.2;
 * docs/performance.md): every named query whose plan the `perf` project
 * checks on the seeded database, and the repository methods each one runs.
 *
 * A repository method that reads `WorkItem`, `Comment`, `SearchVector` or
 * (3.4b) `TimeEntry` is
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
 * take every row they name) or held by a known finding; the search and
 * rebuild budgets are about twice what the fixes of findings F1 and F2
 * measured (decision 245, issues #78 and #79); a budget only goes down
 * (docs/performance.md, "Plan checks"). A search function's own statement is
 * captured too (`auto_explain.log_nested_statements`), so its index and the
 * operator in its condition are checked, and its buffers are counted once,
 * in the function scan that ran it. `maxBuffers100k` is the same budget on
 * the 100k seed, judged by the nightly run (H2b, .github/workflows/perf.yml):
 * about twice what H2b measured there and never below the 10k budget
 * (docs/performance.md, "The 100k budgets"); the two content reads' 100k
 * budgets are about twice what the fix of finding F3 measured (decision 250,
 * issue #89). At another shape the buffers are reported, not judged.
 */

export interface PlanCheckedQuery {
    name: string;
    /** `Class.method` of every repository method the query runs. */
    methods: readonly string[];
    indexes: readonly string[];
    maxBuffers: number;
    /** The same at 100k (H2b), judged by the nightly run: about twice what H2b measured on the 100k seed, never below `maxBuffers`. */
    maxBuffers100k: number;
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

export const PLAN_CHECKED_QUERIES: readonly PlanCheckedQuery[] = [
    // ── The list, in each sort the API offers (one project) ───────────────
    { name: 'list: project, manual order', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_projectId_sortKey_id_idx'], maxBuffers: 700, maxBuffers100k: 800 },
    { name: 'list: project, by updated', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_projectId_updatedAt_id_idx'], maxBuffers: 500, maxBuffers100k: 500 },
    { name: 'list: project, by created', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_projectId_createdAt_id_idx'], maxBuffers: 500, maxBuffers100k: 500 },
    { name: 'list: project, by due date', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_projectId_dueDate_id_idx'], maxBuffers: 850, maxBuffers100k: 950 },
    { name: 'list: project, by priority', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_projectId_priorityRank_id_idx'], maxBuffers: 750, maxBuffers100k: 900 },
    { name: 'list: project, by key', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_projectId_number_key'], maxBuffers: 1000, maxBuffers100k: 2100 },
    { name: 'list: project, second page (keyset)', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_projectId_sortKey_id_idx'], maxBuffers: 1500, maxBuffers100k: 1500 },
    // ── The Work items page: workspace-wide, two filters, by due date ─────
    { name: 'list: workspace, manual order', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_sortKey_id_idx'], maxBuffers: 850, maxBuffers100k: 950 },
    { name: 'list: workspace, two filters, by due date', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_dueDate_id_idx'], maxBuffers: 2600, maxBuffers100k: 2600 },
    { name: 'list: project, label filter', methods: ['WorkItemRepository.list'], indexes: ['WorkItemLabel_tenantId_labelId_workItemId_idx'], maxBuffers: 1100, maxBuffers100k: 2800 },
    { name: 'list: project, custom-field filter', methods: ['WorkItemRepository.list'], indexes: ['CustomFieldValue_tenantId_fieldId_optionId_idx'], maxBuffers: 2100, maxBuffers100k: 7400 },
    { name: 'list: project, sorted by a custom field', methods: ['WorkItemRepository.listByCustomField'], indexes: ['CustomFieldValue_tenantId_fieldId_optionId_idx'], maxBuffers: 5500, maxBuffers100k: 25000 },
    { name: 'list: q (titles, stemmed titles, contents)', methods: ['WorkItemRepository.titleFullTextIds', 'SearchVectorRepository.matchItems', 'WorkItemRepository.titleSubstringIds', 'WorkItemRepository.list'], indexes: ['WorkItem_search_title_fts', 'WorkItem_search_title_trgm', 'SearchVector_search_lexemes', 'SearchVector_search_recent'], maxBuffers: 7000, maxBuffers100k: 86000, conditions: [{ index: 'WorkItem_search_title_fts', operator: '@@' }, { index: 'SearchVector_search_lexemes', operator: '@@' }, { index: 'WorkItem_search_title_trgm', operator: '~~*' }] },
    { name: 'list: the Deleted view', methods: ['WorkItemRepository.listDeleted'], indexes: ['WorkItem_tenantId_deletionId_idx|WorkItem_deletedAt_idx'], maxBuffers: 1800, maxBuffers100k: 4100 },
    // ── The board: one column of the large project ────────────────────────
    { name: 'board: one column (by state)', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_projectId_stateId_sortKey_idx'], maxBuffers: 800, maxBuffers100k: 850 },
    // ── My Work's six sections ─────────────────────────────────────────────
    {
        name: 'my work: to review',
        methods: ['WorkItemRepository.list'],
        indexes: [],
        noIndexBecause: 'the seed holds review rounds only in the 1 % sample (about twenty steps per workspace), so the planner rightly reads the reviewer tables whole; the shape gains bulk reviews with 2.8\'s volume (docs/performance.md, "What the seed leaves out")',
        maxBuffers: 200, maxBuffers100k: 16000,
    },
    { name: 'my work: assigned', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_assigneeId_sortKey_id_idx'], maxBuffers: 1000, maxBuffers100k: 1200 },
    { name: 'my work: waiting on me', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_waitingOnUserId_stateCategory_dueDate_idx'], maxBuffers: 200, maxBuffers100k: 550 },
    { name: 'my work: created', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_createdByUserId_createdAt_idx'], maxBuffers: 1400, maxBuffers100k: 2000 },
    { name: 'my work: watching', methods: ['WorkItemRepository.list'], indexes: ['WorkItemWatcher_tenantId_userId_idx'], maxBuffers: 1600, maxBuffers100k: 3500 },
    { name: 'my work: due soon', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_assigneeId_stateCategory_dueDate_idx|WorkItem_tenantId_assigneeId_sortKey_id_idx'], maxBuffers: 1600, maxBuffers100k: 1800 },
    // ── The detail and what the sheet loads beside it ──────────────────────
    { name: 'detail: the item', methods: ['WorkItemRepository.getById'], indexes: ['WorkItem_pkey|WorkItem_id_tenantId_key|WorkItem_id_projectId_tenantId_key'], maxBuffers: 100, maxBuffers100k: 100 },
    { name: 'detail: comments', methods: ['CommentRepository.list'], indexes: ['Comment_tenantId_workItemId_createdAt_idx'], maxBuffers: 100, maxBuffers100k: 100 },
    { name: 'detail: sub-items and their progress', methods: ['WorkItemRepository.listSubItems', 'WorkItemRepository.subItemProgress'], indexes: ['WorkItem_tenantId_parentId_sortKey_idx'], maxBuffers: 100, maxBuffers100k: 100 },
    { name: 'detail: the subtree and ancestors', methods: ['WorkItemRepository.liveSubtree', 'WorkItemRepository.subtreeHeight', 'WorkItemRepository.ancestors'], indexes: ['WorkItem_tenantId_parentId_sortKey_idx'], maxBuffers: 150, maxBuffers100k: 150 },
    // ── Counts: metrics, cycles, milestones ────────────────────────────────
    { name: 'counts: list metrics (one project)', methods: ['WorkItemRepository.metrics'], indexes: ['WorkItem_tenantId_projectId_sortKey_id_idx|WorkItem_tenantId_projectId_stateId_sortKey_idx|WorkItem_tenantId_projectId_dueDate_id_idx'], maxBuffers: 1400, maxBuffers100k: 5300 },
    { name: 'counts: cycles', methods: ['WorkItemRepository.countsByCycle', 'WorkItemRepository.cycleIdsInUse'], indexes: ['WorkItem_tenantId_cycleId_stateCategory_idx'], maxBuffers: 1100, maxBuffers100k: 1800 },
    { name: 'counts: milestones', methods: ['WorkItemRepository.countsByMilestone'], indexes: ['WorkItem_tenantId_milestoneId_stateCategory_idx'], maxBuffers: 250, maxBuffers100k: 950 },
    // ── Goals and initiatives (3.2a, decisions 211 and 220) ───────────────
    { name: 'list: goal filter (project path or own goal)', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_sortKey_id_idx|WorkItem_tenantId_projectId_sortKey_id_idx'], maxBuffers: 1700, maxBuffers100k: 3000 },
    { name: 'list: initiative filter', methods: ['WorkItemRepository.list'], indexes: ['WorkItem_tenantId_projectId_sortKey_id_idx|WorkItem_tenantId_sortKey_id_idx'], maxBuffers: 700, maxBuffers100k: 750 },
    { name: 'detail: the ancestry (one statement)', methods: ['WorkItemRepository.ancestry'], indexes: ['WorkItem_pkey|WorkItem_id_tenantId_key|WorkItem_id_projectId_tenantId_key'], maxBuffers: 50, maxBuffers100k: 50 },
    { name: "job: the goal purge's unlinked items", methods: ['WorkItemRepository.lockItemsNamingGoals'], indexes: ['WorkItem_tenantId_goalId_stateCategory_idx'], maxBuffers: 10, maxBuffers100k: 50 },
    // ── Progress (3.2b, decisions 211 and 212) ────────────────────────────
    { name: 'counts: progress, the project path', methods: ['WorkItemRepository.countsByProjects'], indexes: ['WorkItem_progress_project_path'], maxBuffers: 10, maxBuffers100k: 100 },
    { name: 'counts: progress, the direct goal path', methods: ['WorkItemRepository.countsByGoals'], indexes: ['WorkItem_tenantId_goalId_stateCategory_idx'], maxBuffers: 10, maxBuffers100k: 50 },
    // ── The roadmap (3.2c, decision 215): one aggregate for every bar and count ──
    // 10k: 1,007 buffers measured (budget 2,000). 100k: NOT MEASURED (3.2c could not seed 100k): 20,000 is
    // ten times the 10k budget, as the read scales with the items of the projects shown; replace it with
    // about twice the nightly's first 100k measurement.
    { name: 'roadmap: the aggregate (every project, both paths)', methods: ['WorkItemRepository.roadmapAggregate'], indexes: ['WorkItem_progress_project_path', 'WorkItem_tenantId_goalId_stateCategory_idx'], maxBuffers: 2000, maxBuffers100k: 20000 },
    { name: 'counts: items in a state', methods: ['TeamRepository.countItemsInState', 'ReviewRepository.itemsInStateRequiringReview', 'WorkItemRepository.lockInState'], indexes: ['WorkItem_tenantId_stateId_idx'], maxBuffers: 6500, maxBuffers100k: 21000 },
    // ── Search: the palette's raw reads ────────────────────────────────────
    { name: 'search: titles (trigram and full text)', methods: ['WorkItemRepository.searchTitleIds'], indexes: ['WorkItem_search_title_fts', 'WorkItem_search_title_trgm'], maxBuffers: 1800, maxBuffers100k: 14000, conditions: [{ index: 'WorkItem_search_title_trgm', operator: '~~*' }, { index: 'WorkItem_search_title_fts', operator: '@@' }] },
    { name: 'search: contents and snippets', methods: ['SearchVectorRepository.matchItems', 'WorkItemRepository.findSearchRows', 'WorkItemRepository.searchSnippetSources'], indexes: ['SearchVector_search_lexemes', 'SearchVector_search_recent', 'WorkItem_search_live_ids', 'Comment_search_live_ids'], maxBuffers: 5000, maxBuffers100k: 73000, conditions: [{ index: 'SearchVector_search_lexemes', operator: '@@' }] },
    // ── The timeline (3.1b) and the calendars it reads (3.1a) ──────────────
    { name: 'timeline: scope, count and relations', methods: ['WorkItemRepository.listForTimeline', 'WorkItemRepository.countForTimeline', 'WorkItemRepository.timelineContextRows'], indexes: ['WorkItem_tenantId_projectId_sortKey_id_idx'], maxBuffers: 2000, maxBuffers100k: 6300 },
    // ── The calendar (3.3a): a month grid's 42 days, its count and the undated items ──
    // 10k: 2,576 buffers measured for the workspace (the window read per visible project on the
    // project-leading due-date index, about 730 items; the undated count a tenant bitmap), 466 for a
    // project. 100k: NOT MEASURED (3.3a could not seed 100k for lack of disk): a workspace month there holds
    // about 7,300 items, over the 2,000 limit, so the read becomes the refusal (2,001 rows, the window's
    // count and the undated count over about 40,000 items): about 20,000 buffers estimated, budget twice
    // that; a project month about ten times the 10k figure. Replace both with about twice the nightly's
    // first 100k measurement.
    { name: 'calendar: workspace, a month grid', methods: ['WorkItemRepository.listForCalendar', 'WorkItemRepository.countForCalendar', 'WorkItemRepository.countWithoutDueDate'], indexes: ['WorkItem_tenantId_dueDate_id_idx|WorkItem_tenantId_projectId_dueDate_id_idx'], maxBuffers: 5200, maxBuffers100k: 40000 },
    { name: 'calendar: project, a month grid', methods: ['WorkItemRepository.listForCalendar', 'WorkItemRepository.countWithoutDueDate'], indexes: ['WorkItem_tenantId_projectId_dueDate_id_idx'], maxBuffers: 1000, maxBuffers100k: 10000 },
    // ── Calendar sync (3.3b): a member's open assigned items in the push window, their count, their projects ──
    // 10k: 3,718 buffers measured for the heavy member (the window's items on the assignee index, the
    // count, and every open assigned item grouped by project). 100k: NOT MEASURED (no disk for the seed
    // here): about ten times, budgeted as such; replace with about twice the nightly's first measurement.
    {
        name: "calendar sync: a member's items and projects",
        methods: ['WorkItemRepository.listAssignedForCalendarSync', 'WorkItemRepository.countAssignedForCalendarSync', 'WorkItemRepository.projectsWithOpenAssigned'],
        indexes: ['WorkItem_tenantId_assigneeId_stateCategory_dueDate_idx'],
        maxBuffers: 7500,
        maxBuffers100k: 75000,
    },
    {
        name: 'timeline: working calendars',
        methods: [],
        indexes: [],
        noIndexBecause: 'a workspace holds one calendar per team and its holidays (at most 500 each): a sequential scan of a few pages is the cheapest plan at every workspace size; the budget holds it small',
        maxBuffers: 100, maxBuffers100k: 100,
    },
    // ── Time entries (3.4b): a person's week, a day's total and the timer, an item's time ──
    // 10k (about 29,000 entries a workspace): 121 to 142 buffers measured for the heavy member's week (its rows and
    // the index pages, heap-fetched), 21 for a day's total and the timer, 17 for the item with the most time.
    // 100k: NOT MEASURED (no disk for the 100k seed here; issue #93's extrapolation): the heavy member's week holds
    // more rows there (Zipf over 200 writers, bounded by 24 hours a day), about three times the 10k read, and an
    // item's entries do not grow with the workspace; each budget about twice that. Replace with about twice the
    // nightly's first 100k measurement.
    { name: "time: a person's week", methods: ['TimeEntryRepository.listForPerson'], indexes: ['TimeEntry_tenantId_userId_workDate_idx'], maxBuffers: 300, maxBuffers100k: 900 },
    {
        name: "time: a day's total and the running timer",
        methods: ['TimeEntryRepository.dayTotal', 'TimeEntryRepository.running'],
        indexes: ['TimeEntry_tenantId_userId_workDate_idx', 'TimeEntry_one_timer_per_person|TimeEntry_tenantId_userId_workDate_idx'],
        maxBuffers: 50,
        maxBuffers100k: 150,
    },
    { name: "time: an item's total and first page", methods: ['TimeEntryRepository.itemTotals', 'TimeEntryRepository.itemPage'], indexes: ['TimeEntry_tenantId_workItemId_workDate_idx'], maxBuffers: 50, maxBuffers100k: 100 },
    // Sub-phase 3.4c: a week's sums (submit, a decision, the status line) and the Timesheets page's sums of a
    // page of weeks (each week on the person's index). Estimated as 3.4b's week, the page as 50 such weeks.
    { name: "timesheets: a week's sums", methods: ['TimeEntryRepository.weekSums'], indexes: ['TimeEntry_tenantId_userId_workDate_idx'], maxBuffers: 50, maxBuffers100k: 150 },
    { name: "timesheets: a page of weeks' sums", methods: ['TimeEntryRepository.sumsForWeeks'], indexes: ['TimeEntry_tenantId_userId_workDate_idx'], maxBuffers: 600, maxBuffers100k: 1800 },
    // ── Writes' reads: placement, moves, a member's removal ────────────────
    { name: 'placement: sort keys around a position', methods: ['WorkItemRepository.lastSortKey', 'WorkItemRepository.nextSortKeyAfter', 'WorkItemRepository.prevSortKeyBefore', 'WorkItemRepository.liveSortKeysAmong'], indexes: ['WorkItem_tenantId_projectId_sortKey_id_idx'], maxBuffers: 100, maxBuffers100k: 100 },
    { name: 'removal: a member\'s items', methods: ['WorkItemRepository.lockItemsOfPerson'], indexes: ['WorkItem_tenantId_assigneeId_stateCategory_dueDate_idx|WorkItem_tenantId_assigneeId_sortKey_id_idx', 'WorkItem_tenantId_waitingOnUserId_stateCategory_dueDate_idx', 'CustomFieldValue_tenantId_userId_idx|CustomFieldValue_tenantId_fieldId_userId_idx'], maxBuffers: 7500, maxBuffers100k: 88000 },
    { name: 'deletion: a deletion group', methods: ['WorkItemRepository.idsOfDeletion'], indexes: ['WorkItem_tenantId_deletionId_idx'], maxBuffers: 100, maxBuffers100k: 100 },
    { name: 'cycle and milestone deletes: their items', methods: ['WorkItemRepository.idsInCycleIncludingDeleted', 'WorkItemRepository.idsInMilestoneIncludingDeleted', 'WorkItemRepository.rolloverCandidates'], indexes: ['WorkItem_tenantId_cycleId_stateCategory_idx', 'WorkItem_tenantId_milestoneId_stateCategory_idx'], maxBuffers: 2400, maxBuffers100k: 4400 },
    { name: 'templates: open items of a project', methods: ['WorkItemRepository.openItemsForTemplate'], indexes: ['WorkItem_tenantId_parentId_sortKey_idx|WorkItem_tenantId_projectId_sortKey_id_idx'], maxBuffers: 1700, maxBuffers100k: 3400 },
    // ── Jobs: reminders, the digest, the purge, the rebalance, the rebuild ─
    { name: 'job: due reminders', methods: ['WorkItemRepository.dueCandidates'], indexes: ['WorkItem_tenantId_stateCategory_dueDate_idx|WorkItem_tenantId_projectId_dueDate_id_idx|WorkItem_tenantId_dueDate_id_idx'], maxBuffers: 150, maxBuffers100k: 1300 },
    { name: 'job: the daily digest', methods: ['WorkItemRepository.digestDueItems'], indexes: ['WorkItem_tenantId_assigneeId_stateCategory_dueDate_idx|WorkItem_tenantId_dueDate_id_idx'], maxBuffers: 1100, maxBuffers100k: 5400 },
    { name: 'job: the purge sweep', methods: ['WorkItemRepository.purgeableIds'], indexes: ['WorkItem_deletedAt_idx'], maxBuffers: 150, maxBuffers100k: 1500 },
    { name: 'job: a purged project', methods: ['WorkItemRepository.countLiveInProject', 'WorkItemRepository.projectItemIds'], indexes: ['WorkItem_tenantId_projectId_sortKey_id_idx|WorkItem_tenantId_projectId_number_key|WorkItem_tenantId_projectId_createdAt_id_idx'], maxBuffers: 400, maxBuffers100k: 1600 },
    { name: 'job: the sort-key rebalance', methods: ['WorkItemRepository.projectsNeedingRebalance', 'WorkItemRepository.orderedPageIncludingDeleted'], indexes: ['WorkItem_tenantId_projectId_sortKey_id_idx'], maxBuffers: 500, maxBuffers100k: 3100 },
    // Sub-phase 3.4c: the Monday reminder's people who recorded time last week (one workspace's week).
    { name: 'job: the timesheet reminder', methods: ['TimeEntryRepository.peopleWithTimeIn'], indexes: ['TimeEntry_tenantId_userId_workDate_idx|TimeEntry_tenantId_projectId_workDate_idx'], maxBuffers: 400, maxBuffers100k: 4000 },
    { name: 'job: the search-index rebuild', methods: ['SearchVectorRepository.staleDescriptionPage', 'SearchVectorRepository.staleCommentPage'], indexes: ['SearchVector_one_per_description', 'SearchVector_one_per_comment', 'Comment_search_live_ids'], maxBuffers: 10000, maxBuffers100k: 10000 },
];

/**
 * Repository methods that read a guarded table and are not plan-checked,
 * each with its reason. A reason is a fact about the query's shape, never
 * "too hard to set up".
 */
export const PLAN_CHECK_EXEMPT: Readonly<Record<string, string>> = {
    'CalendarSyncRepository.connectedOfAssignees': 'the named items by primary key (at most 500, after a change to them), joined to their assignees\' calendar connections (3.3b)',
    'WorkItemRepository.findVisible': 'one item by primary key (the write gate)',
    'WorkItemRepository.findDeletedForRestore': 'one item by primary key',
    'WorkItemRepository.lockForWrite': 'the given ids by primary key, locked in id order (decision 173)',
    'WorkItemRepository.lockParentForKeyShare': 'one row by primary key, read FOR KEY SHARE before a create names a person (issue #113)',
    'WorkItemRelationRepository.liveBlocksReach': 'a recursive walk of BLOCKS edges from one item, bounded by the reschedule cap (at most 100 items, decision 194) and read through the relation endpoint indexes (3.1c)',
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
    'TimeEntryRepository.get': 'one time entry by primary key (the write gate of a change or a delete, 3.4b)',
};

/** A query's buffer budget at a shape: 10k and 100k are judged, any other shape is reported only (`null`). */
export function bufferBudgetAt(q: PlanCheckedQuery, shape: string): number | null {
    if (shape === '10k') return q.maxBuffers;
    if (shape === '100k') return q.maxBuffers100k;
    return null;
}
