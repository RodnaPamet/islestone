# Pagination conventions

The query parameters and response contract of every cursor-paginated list endpoint. Copied from inflect-compliance `docs/pagination.md` at `5528464fc54a8681956f3b9ce23ca9c075f0420e` and rewritten for Islestone's keyset cursor (sub-phase 2.2).

## Response contract

```json
{
  "items": [...],
  "pageInfo": {
    "nextCursor": "eyJrIjoiViIsImlkIjoiY…",
    "hasNextPage": true
  }
}
```

A list is cursor-only: there is no unpaginated form (roadmap H2 seeds 100,000 items per workspace). The one flat read is the Deleted work-item view, `{ rows, truncated }`, capped at 200 rows (`WORK_ITEM_DELETED_LIST_CAP`, `src/lib/list-backfill-cap.ts`).

## Query parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | int (1–100) | 20 | Page size (`clampLimit`) |
| `cursor` | string | — | Opaque pagination token from the previous page |
| `order` | `manual` / `updated` / `created` / `due` / `priority` / `key` / `cf:<fieldId>` | `manual` | Work items (2.4 added all but the first two): manual order `(sortKey, id)`; recently changed `(updatedAt, id)` desc; newest `(createdAt, id)` desc; due date `(dueDate, id)` asc, nulls last; priority, urgent first `(priorityRank, id)` asc; key `(project prefix, number, id)` asc; a custom field's value asc, empty values last |
| `dir` | `asc` / `desc` | per order | Reverses the order's default direction (not for `manual`); nulls stay last |
| `cf.<fieldId>` | `<op>[:<operand>]` | — | A custom-field condition (2.4; `docs/work-items.md`, "Custom fields and saved views"); at most ten |
| `q` | string | — | The title (case-insensitive) or an exact key such as `ISL-12` |
| `projectId`, `teamId`, `typeId`, `stateId`, `labelId`, `assigneeId`, `createdById`, `parentId` | id, or a comma-joined list | — | `assigneeId=none` is unassigned, `parentId=none` top-level only; `createdById` is the creator |
| `watching` | `me` | — | The items the caller watches; the caller is the request's user, and any other value is a 400 |
| `stateCategory`, `priority` | enum, or a comma-joined list | — | Validated by `parseEnumListFilter`; an unknown member is a 400 |
| `due` | `overdue` / `next7d` / `soon` | — | Open items due before today, in the next seven days, or (`soon`) overdue or due within `DUE_SOON_DAYS` (7, `src/app-layer/domain/work-item-due.ts`); today is the date in `NOTIFICATIONS_TZ` |
| `includeArchived` | `1` / `true` | — | Include archived projects' items |

## Cursor design

- **Payload:** `{ k, id }` for a single-column order (`buildKeysetWhere`: the activity feed, sub-items), where `k` is the last row's value in the ordering column and `id` breaks ties, so a page boundary inside a run of equal keys neither skips nor repeats a row. The work-item list (2.4) uses the multi-column form `{ v: [...], id }` (`buildSortWhere`, `sortOrderBy`, `computeSortPage`): one value per column of the order (`listSortSpec`), each possibly `null`. Nulls sort last in both directions; "after" a value includes every null, and after a null only a later `id` among the nulls. A custom-field order's cursor is `{ v: [phase, value], id }`: phase 0 walks the field's value rows (its `id` is the value row's), phase 1 the items with no value (its `id` is the item's).
- **Encoding:** URL-safe base64 of the JSON.
- **Ordering:** `[{ <column>: <direction> }, { id: <direction> }]` (`keysetOrderBy`); the `where` is `(column > k) OR (column = k AND id > id)` for ascending, `<` for descending (`buildKeysetWhere`).
- **Strategy:** fetch `limit + 1` rows; the extra row signals `hasNextPage` (`computeKeysetPage`).
- **Refusal:** a cursor that does not decode to that shape is a 400, never read as the first page.

## Rules

1. **A cursor belongs to its filters and its order.** Changing either starts from the first page.
2. **Limit is clamped** to `[1, 100]`, default `20`.
3. **Never reuse a cursor of one ordering under another:** a `(createdAt, id)` cursor applied to a `sortKey` order silently skips or repeats rows, which is why the helper takes the order explicitly.
4. **Every list query has a backing index** that leads with `tenantId` and ends with the ordering column (ADR 0002 §13; `tests/guards/schema-index-coverage.test.ts`): 2.4 added `[tenantId, projectId, createdAt, id]`, `[tenantId, projectId, dueDate, id]` and `[tenantId, projectId, priorityRank, id]` on `WorkItem`, and the value table's `[tenantId, fieldId, <column>]`.
5. **`priorityRank` is the trigger's.** Postgres orders `WorkItemPriority` by declaration (`NONE` first), so the priority sort reads `WorkItem.priorityRank` (URGENT 1 … NONE 5), which only the `work_item_priority_rank` trigger writes.
