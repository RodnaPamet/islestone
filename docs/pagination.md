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
| `order` | `manual` / `updated` | `manual` | Work items: manual order `(sortKey, id)` ascending, or recently changed `(updatedAt, id)` descending |
| `q` | string | — | The title (case-insensitive) or an exact key such as `ISL-12` |
| `projectId`, `teamId`, `typeId`, `stateId`, `labelId`, `assigneeId`, `createdById`, `parentId` | id, or a comma-joined list | — | `assigneeId=none` is unassigned, `parentId=none` top-level only; `createdById` is the creator |
| `watching` | `me` | — | The items the caller watches; the caller is the request's user, and any other value is a 400 |
| `stateCategory`, `priority` | enum, or a comma-joined list | — | Validated by `parseEnumListFilter`; an unknown member is a 400 |
| `due` | `overdue` / `next7d` / `soon` | — | Open items due before today, in the next seven days, or (`soon`) overdue or due within `DUE_SOON_DAYS` (7, `src/app-layer/domain/work-item-due.ts`); today is the date in `NOTIFICATIONS_TZ` |
| `includeArchived` | `1` / `true` | — | Include archived projects' items |

## Cursor design

- **Payload:** `{ k, id }`, where `k` is the last row's value in the list's ordering column (`sortKey`, or `updatedAt` as ISO-8601) and `id` breaks ties, so a page boundary inside a run of equal keys neither skips nor repeats a row.
- **Encoding:** URL-safe base64 of the JSON.
- **Ordering:** `[{ <column>: <direction> }, { id: <direction> }]` (`keysetOrderBy`); the `where` is `(column > k) OR (column = k AND id > id)` for ascending, `<` for descending (`buildKeysetWhere`).
- **Strategy:** fetch `limit + 1` rows; the extra row signals `hasNextPage` (`computeKeysetPage`).
- **Refusal:** a cursor that does not decode to that shape is a 400, never read as the first page.

## Rules

1. **A cursor belongs to its filters and its order.** Changing either starts from the first page.
2. **Limit is clamped** to `[1, 100]`, default `20`.
3. **Never reuse a cursor of one ordering under another:** a `(createdAt, id)` cursor applied to a `sortKey` order silently skips or repeats rows, which is why the helper takes the order explicitly.
4. **Every list query has a backing index** that leads with `tenantId` and ends with the ordering column (ADR 0002 §13; `tests/guards/schema-index-coverage.test.ts`).
