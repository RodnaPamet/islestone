# teable study

Studied 2026-11-18 for Islestone roadmap 2.4 (saved views and custom fields). Read-only: nothing in the clone was run, built or installed. Only `packages/*` was read for code. Under `apps/`, `plugins/` and the root, only the licence files and the `license` field of each `package.json` were read.

## 1. Pin and licence facts

**Pin.** `github.com/teableio/teable`, branch `develop`, commit `bd8cfc054f521f6f9019f62dec2f9fcb1273ecec` (2026-11-18T17:48:37+08:00, "[sync] feat: enhance v2 query engine, security, templates and collaboration experience (#3702)"). The clone was made with `--filter=blob:none` and has full history (2,829 commits).

**Facts as given by the workflow, and confirmed at this commit:**

- The licence is mixed. AGPL-3.0, written that way with no `-only` or `-or-later`, covers `apps/nestjs-backend`, `apps/nextjs-app`, `plugins/` and the root workspace. Each `package.json` `license` field says `AGPL-3.0`: `@teable/backend`, `@teable/app`, `@teable/plugin` and the root `@teable/teable`. `plugins/LICENSE` is the plain AGPL-3.0 text: byte-identical to the first 661 lines of `AGPL_LICENSE`, without the Section 7(e) term below.
- `AGPL_LICENSE` (lines 663–679) and root `LICENSE` add a Section 7(e) "Brand Protection" term. Teable's name, logo, icons and visual identity may not be modified, replaced or removed, or used to suggest endorsement.
- Root `LICENSE`, item 2: "All packages under the 'packages' directory are licensed under the MIT License."
- `enterprise/` has 0 tracked files. It is referenced from code but absent from the public tree.
- `packages/icons/src/components/TeableAi.tsx` and `TeableNew.tsx` are brand marks.

**Facts found in this study:**

1. **Per-package LICENSE files.**
   - Eight packages carry a byte-identical MIT `LICENSE`, "Copyright (c) 2023-2025 Teable, Inc." (sha1 `4acf799f…`): `common-i18n`, `core`, `db-main-prisma`, `eslint-config-bases`, `icons`, `openapi`, `sdk`, `ui-lib`.
   - **No LICENSE file** in `packages/formula`, `packages/i18n-keys`, `packages/db-data-prisma`, or any of the 47 `packages/v2/*` workspaces (48 directories; `packages/v2/test-node` holds one test file and no `package.json`). Each of their `package.json` files says `"license": "MIT"`. The v2 workspaces and `db-data-prisma` are `private: true`. `formula` and `i18n-keys` are not private (`formula` sets `publishConfig.access: public`), but the npm registry answered 404 for both on 2026-11-18, so neither is published. `@teable/core` is published (1.10.0, MIT).
   - These packages are MIT only through the root statement. That statement also says "see the individual LICENSE files in each package directory", and for these packages none exists.
2. **Packages became MIT on 2024-08-19,** in commit `9c77957afe43034a9e71f8c2ddd4de48b77b5266`, "chore: packages release under MIT license (#844)". That commit replaced the root AGPL `LICENSE` with the mixed statement and added the eight LICENSE files. **Before it, everything, `packages/` included, was AGPL-3.0.** Islestone must read and copy only from revisions at or after that commit. The pin above qualifies (`9c77957af` is an ancestor of it). `packages/formula` and `packages/v2/*` did not exist then: both were added on 2026-02-11 (`367739c6d`). The formula code was moved out of `packages/core/src/formula`, so its pre-2024-08-19 history is AGPL like the rest of `packages/core`.
3. **Third-party notices inside `packages/formula`.** `src/parser/Formula.g4` lines 1–24: "Portions of this file are based on Baserow software. Copyright (c) 2019-present Baserow B.V.", MIT. `src/parser/FormulaLexer.g4` lines 1–19: "Copyright 2018 Tal Shprecher", MIT. A port of either grammar, or of the generated parser built from it (`Formula.ts`, `FormulaLexer.ts`), must carry both notices as well as Teable's. (Unrelated to 2.4: `packages/openapi/src/openapi-snippet/index.js` names its own author, Erik Wittern, MIT.) No AGPL, GPL or other copyleft or source-available marker appears anywhere under `packages/`.
4. **No CLA or DCO** was found in `CONTRIBUTING.md` or `.github/`. `git log` shows 18 authors on `packages/core`, 11 of them before the relicence commit. `packages/formula` shows one author under its own path, because it was split out of `packages/core/src/formula`, which had 6 authors before the relicence. Much recent history consists of `[sync]` commits from an upstream repository, so the public log may undercount contributors. The 2024 relicence is clearly valid for code Teable, Inc. owns. Whether every pre-2024 contributor agreed to it cannot be verified from the repository. The risk is low, because the copyright line names only Teable, Inc.; it is recorded as open question 1.
5. **Brand strings inside MIT files.** `packages/core/src/models/view/filter/filter.ts` (the `FILTER_DESCRIPTION` constant) links to `app.teable.ai`. `field.schema.ts` says "field types supported by teable". `color-utils.ts` doc comments name `@teable/sdk`. Strip these from anything ported.
6. **Runtime dependencies** of the relevant packages. Licences are from the npm registry, read 2026-11-18:
   - `@teable/formula` depends only on `antlr4ts` 0.5.0-alpha.4 (BSD-3-Clause). That version has been the latest since 2021-01-01, and it is still alpha.
   - `@teable/core` adds `dayjs` (MIT), `date-fns-tz` (MIT), `ts-pattern` (MIT), `zod` 4.6.7, `lodash`, `nanoid` and others.
   - v2 packages use `neverthrow` (MIT).
   - Maintained ANTLR runtimes, if a grammar is ever ported: `antlr4` 4.13.2 and `antlr4ng` 3.0.16, both BSD-3-Clause.
   - All of these are on Islestone's allowlist (`scripts/licence-gate.mjs`).

**Could not verify:**

- The GitHub REST API returned no repository metadata (no licence detection, no archived flag). A second try in the licence check also got HTTP 403, because GitHub API access is not enabled for this session.
- Trademark registrations for "Teable".
- Whether the relicence had every contributor's consent (fact 4).
- Whether Teable intends the missing per-package LICENSE files (fact 1).

## 2. What `packages/` holds, and what matters for 2.4

| Package | Role | Relevance |
|---|---|---|
| `packages/core` (329 files) | v1 shared domain: field types, view/filter/sort/group schemas, formula evaluator, query DSL | **High.** Field registry, option schemas, operator matrix, filter tree |
| `packages/formula` (32 files) | ANTLR grammar and generated parser for formulas, plus reference visitors | Deferred. No roadmap sub-phase has formulas |
| `packages/v2/core` (1,409 files, ~146,600 non-test TS lines) | v2 DDD rewrite: value objects per option, specs, filter sync on schema change, safety limits | **Medium.** Filter sync, limits, the user-filter remap |
| `packages/v2/adapter-table-repository-postgres` | v2 filter → SQL over Teable's physical columns | **Medium, as semantics only**: relative dates, null handling of negative operators |
| `packages/v2/formula-sql-pg` (~10,000 lines) | Formula AST → Postgres SQL | Deferred |
| `packages/v2/field-dependency-core` (687 lines) | Dependency edges between computed fields | Deferred |
| `packages/db-main-prisma` | Teable's metadata Prisma schema (`template.prisma`, 1,358 lines) | Read for the data model only |
| `packages/sdk` (React) | Editors, filter UI (`components/filter`, 88 files, ~5,600 lines) | Low. Islestone has its own filter system. Ideas only |
| `packages/icons` | Icons, including two brand marks | Do not take the brand marks |

## 3. Parts worth porting (exact paths and line counts)

Every path below is under the clone root at the pinned commit. Line counts are `wc -l`. Group A feeds 2.4 directly. Group B is reference material for 2.4's semantics. Group C is deferred.

### A. 2.4 custom fields and saved views

| Path | Lines | What it gives |
|---|---|---|
| `packages/core/src/models/field/constant.ts` | 107 | The 20-type `FieldType` enum, `CellValueType` (string, number, boolean, dateTime), `DbFieldType`, and the per-type capability sets (primary-capable, import-capable, unique-capable, not-null-capable) |
| `packages/core/src/models/field/field.ts` | 267 | Abstract `FieldCore`: the contract every type implements (`convertStringToCellValue`, `repair`, `validateCellValue`, `cellValue2String`, `item2String`, `isSearchable`, `matchSearch`, `accept`) |
| `packages/core/src/models/field/field-visitor.interface.ts` | 56 | Exhaustive visitor, one method per type |
| `packages/core/src/models/field/options.schema.ts` | 68 | `type → options schema` dispatch |
| `packages/core/src/models/field/cell-value-validation.ts` | 70 | `type → value schema` dispatch |
| `packages/core/src/models/field/field-validation.ts` | 35 | Which types allow `unique` and `notNull` |
| `packages/core/src/models/field/derivate/abstract/select.field.abstract.ts` | 109 | Select options; a memoised name→choice map |
| `packages/core/src/models/field/derivate/abstract/select-option.schema.ts` | 34 | Choice `{id, name, color}`, default value, `preventAutoNewOptions` |
| `packages/core/src/models/field/derivate/single-select.field.ts` | 58 | String → value, repair |
| `packages/core/src/models/field/derivate/multiple-select.field.ts` | 79 | Quote-aware comma split in one linear pass |
| `packages/core/src/models/field/derivate/number.field.ts` + `number-option.schema.ts` | 94 + 18 | Number options and conversions |
| `packages/core/src/models/field/formatting/number.ts` | 117 | Decimal, percent and currency formatting; precision 0–5; safe output above 2^53 |
| `packages/core/src/models/field/derivate/date.field.ts` + `date-option.schema.ts` | 144 + 16 | Date parsing: ISO first, then the field's own format, then the time zone |
| `packages/core/src/models/field/formatting/datetime.ts` | 81 | Date presets, 12h/24h/no time, time zone |
| `packages/core/src/models/field/derivate/checkbox.field.ts` | 87 | "Only `true` or null" rule |
| `packages/core/src/models/field/derivate/single-line-text.field.ts` + option schema | 83 + 13 | Trim, collapse newlines, empty → null |
| `packages/core/src/models/field/show-as/text.ts` | 35 | URL display deprecated in favour of auto-detect (see 5.2) |
| `packages/core/src/models/field/derivate/user.field.ts` + `user-option.schema.ts` + `abstract/user.field.abstract.ts` | 94 + 21 + 50 | Person field: `isMultiple`, `shouldNotify`, default `me` |
| `packages/core/src/models/view/filter/operator.ts` | 503 | **The operator vocabulary and the per-type operator matrix** |
| `packages/core/src/models/view/filter/filter-item.ts` | 189 | Condition schema; value shapes per operator; date-mode schema |
| `packages/core/src/models/view/filter/filter.ts` | 367 | Nested and/or tree; merge; field extraction; strip; validation with codes and paths |
| `packages/core/src/models/view/sort/sort.ts` | 98 | Sort items; manual sort; merging a view's default with a query's sort |
| `packages/core/src/models/view/group/group.ts` | 42 | Group items, capped at 3 |
| `packages/core/src/models/view/column-meta.schema.ts` | 152 | Per-view, per-field order, width, hidden and statistic |
| `packages/core/src/models/view/view.schema.ts` | 112 | View object; options checked by view type |
| `packages/core/src/models/view/derivate/kanban-view-option.schema.ts` | 22 | `stackFieldId`: board grouping by a field |
| `packages/v2/core/src/domain/table/fields/filter-sync.ts` | 531 | **Rewrites saved filters when a field's type or options change** |
| `packages/v2/core/src/domain/table/fields/user-filter-operator-remap.ts` | 111 | Operator remap when a person field switches between single and multiple; the `Me` token |
| `packages/v2/core/src/domain/shared/TableDataSafetyLimits.ts` | 297 | Concrete caps (section 5.8) |
| `packages/v2/core/src/domain/table/fields/types/SelectOptions.ts` | 79 | Unique choice names; default must name a choice; count and length caps |

Usable test suites (MIT), to rewrite as Islestone test cases:

- `filter.spec.ts` (501), `operator.spec.ts` (228), `number.spec.ts` (208), `date.field.spec.ts` (253), `user.field.spec.ts` (178), `multiple-select.field.spec.ts` (98), `sort.schema.spec.ts` (117);
- v2 `filter-sync.spec.ts` (335).

### B. Semantics reference (read, do not port as code)

| Path | Lines | Why |
|---|---|---|
| `packages/v2/adapter-table-repository-postgres/src/record/visitors/TableRecordConditionWhereVisitor.ts` | 2,709 | Relative-date range resolution (lines 308–367 and 660–840), null semantics of negative operators, set operators. Built over physical JSONB columns, so its SQL does not transfer |
| `packages/core/src/query/parser/Query.g4` + `QueryLexer.g4` + `json.visitor.ts` | 88 + 79 + 183 | A textual filter language compiled to the same filter tree. A candidate target for 7.3 natural-language views |
| `packages/db-main-prisma/prisma/template.prisma` (`Field` 333–370, `View` 628–656, `Reference` 672–682) | 1,358 | Teable's metadata model (section 4) |

### C. Deferred: the formula engine

| Path | Lines | What it gives |
|---|---|---|
| `packages/formula/src/parser/Formula.g4` + `FormulaLexer.g4` | 78 + 159 | The grammar (Baserow and Tal Shprecher notices) |
| `packages/formula/src/field-reference.util.ts` | 59 | Extracts `{fieldId}` references with the lexer only, never the parser |
| `packages/core/src/formula/visitor.ts` | 543 | Tree-walking evaluator with type inference |
| `packages/core/src/formula/functions/common.ts` + `factory.ts` | 152 + 177 | The function contract and registry (about 75 functions) |
| `packages/core/src/formula/typed-value-converter.ts` | 128 | Argument coercion |
| `packages/core/src/formula/errors/circular-reference.error.ts` | 53 | Cycle error carrying its expansion chain |
| `packages/v2/field-dependency-core/src/types.ts` + `edge-builder.ts` | 150 + 214 | Typed dependency edges |
| `packages/v2/formula-sql-pg/src/FormulaCompileBudget.ts` + `PgSqlHelpers.ts` | 309 + 210 | SQL compile budget; literal escaping |

## 4. Data model (Teable's, transcribed compactly)

Teable's metadata lives in Prisma (`template.prisma`). The **data** does not. Each Teable table is a real Postgres table, `TableMeta.dbTableName`, and each field is a real column, `Field.dbFieldName`, matching `^\w{0,63}$`. Adding a field is DDL.

```
Space 1─* Base 1─* TableMeta 1─* Field
                              └─* View
TableMeta(id, baseId, name, dbTableName, dbViewName?, version, order:Float, deletedTime?)
Field(id, tableId→TableMeta, name, description?, type:String, options:String(JSON)?, meta:String(JSON)?,
      cellValueType, isMultipleCellValue?, dbFieldType, dbFieldName, notNull?, unique?, isPrimary?,
      isComputed?, isLookup?, isConditionalLookup?, isPending?, hasError?,
      lookupLinkedFieldId?, lookupOptions:String(JSON)?, order:Float, version:Int, deletedTime?)
      @@index(tableId, deletedTime) @@index(lookupLinkedFieldId)
View(id, tableId→TableMeta, name, type, sort:JSON?, filter:JSON?, group:JSON?, options:JSON?,
     columnMeta:JSON  // {fieldId: {order:Float, width?, hidden?|visible?, statisticFunc?, required?}}
     order:Float, version:Int, isLocked?, enableShare?, shareId? @unique, shareMeta:JSON?, deletedTime?)
Reference(fromFieldId, toFieldId) @@unique(toFieldId, fromFieldId)  // formula/lookup dependency edges
Ops(collection, docId, docType, version, operation) @@unique(collection, docId, version)  // ShareDB op log
<dbTableName>(__id, __auto_number, __created_time, …, <dbFieldName> per field)  // the record table
```

Value storage, from `utils/get-db-field-type.ts`:

- any multi-valued field → `JSON`;
- link, user, attachment, button, created-by, last-modified-by → `JSON`;
- auto-number → `INTEGER`;
- anything else by its value type: number → `REAL`, dateTime → `DATETIME`, boolean → `BOOLEAN`, string → `TEXT`.

Cell values carry these shapes:

| Type | Cell value |
|---|---|
| select | choice **name** (string) |
| multi-select | array of names |
| user | snapshot `{id, title, email?, avatarUrl?}` |
| date | ISO instant with offset |
| checkbox | `true` or null |

Options, as JSON on the field:

| Type | Options |
|---|---|
| select | `choices[{id, name, color}]`, `defaultValue`, `preventAutoNewOptions` |
| number | `formatting{type: decimal\|percent\|currency, precision 0–5, symbol ≤10}`, `showAs`, `defaultValue` |
| date | `formatting{date: preset, time: HH:mm\|hh:mm A\|None, timeZone}`, `defaultValue: 'now'` |
| user | `isMultiple`, `shouldNotify`, `defaultValue: usr…\|'me'\|array` |
| single-line text | `showAs{email\|phone\|url(deprecated)}`, `defaultValue` |
| rating | `icon`, `color`, `max` 1–10 |

Filter, sort and group are JSON, and are validated:

```
Filter    = { conjunction: and|or, filterSet: (Condition | Filter)[] } | null
Condition = { fieldId, operator, value, isSymbol? }
value     = literal | literal[] (nonempty) | DateFilter | {type:'field', fieldId, tableId?} | null
DateFilter = { mode, numberOfDays?, exactDate?, exactDateEnd?, timeZone }
Sort      = { sortObjs: {fieldId, order: asc|desc}[], manualSort? }
Group     = {fieldId, order}[]   (max 3)
```

**How this maps onto Islestone (ADR 0002 section 7, the schema sketch at lines 372–415):**

| Teable | Islestone |
|---|---|
| `Field` | `CustomField(projectId, name, type, position, archivedAt)` |
| `choices[]` (JSON) | `CustomFieldOption` rows, with real ids and an FK |
| one physical column per field | one `CustomFieldValue` row per item and field, typed columns, a CHECK, two partial unique indexes |
| `View` | `SavedView` |
| `columnMeta` | the view's visible columns |
| kanban `stackFieldId` | board grouping (2.3) |

What transfers is the **domain layer**: types, options, value rules, operators, the filter tree, schema-change sync. Teable's **storage layer** (physical columns, DDL per field, JSON multi-values, name-keyed values, user snapshots) contradicts ADR 0002 and does not transfer.

## 5. Algorithms (prose and pseudo-code; nothing copied)

### 5.1 Field-type registry and dispatch

There is one abstract field class with a fixed contract. Each type is a subclass. Three exhaustive switches cover the type enum (options schema, value schema, database type), and an exhaustive visitor covers the rest. Unknown types fail at compile time through `assertNever`.

For Islestone:

```
CUSTOM_FIELD_TYPES: Record<CustomFieldType, FieldTypeSpec>   // `satisfies`, so a new enum member fails tsc
FieldTypeSpec = {
  valueColumn: 'textValue'|'numberValue'|'dateValue'|'boolValue'|'optionId'|'userId',
  multiple: boolean,                    // MULTI_SELECT only
  optionsSchema: ZodType,               // per-type settings (number format, date format, …)
  parseInput(raw: unknown, ctx) -> Value | null | Refusal,   // API and form writes: strict
  fromText(text, ctx) -> Value | null,                        // paste, CSV, importer: lenient
  toText(value, settings) -> string,                          // export, notifications, search text
  operators: Operator[],                                      // section 5.3
  searchable(keyword) -> boolean,                             // 2.7
}
```

`parseInput` and `fromText` are kept apart on purpose. Teable separates `validateCellValue` (strict, for writes) from `convertStringToCellValue` and `repair` (lenient, for paste, import and type conversion). Islestone's API path must use only the strict one.

### 5.2 Value normalisation rules worth adopting

- **Text.** Replace CR, LF and tab with spaces, trim, and store empty as null (no row). Islestone adds the ADR's 500-character cap.
- **Select.** The value must match an existing option; an unknown one is refused. Teable's lenient path collapses newlines and trims. Its `preventAutoNewOptions` flag (off by default) lets a write naming an unknown choice create it. Islestone should **not** auto-create on ordinary item writes. Creating an option is a field-settings change and needs its own permission.
- **Multi-select text input.**
  - The splitter is a single linear scan. Split on `,`, CR or LF outside double quotes, drop one whitespace character after each separator, and strip the quotes from quoted parts. Then de-duplicate the parts and keep only those that match an option. An empty result is null.
  - Teable also replaced a regex with this linear scan (see the comment at `multiple-select.field.ts` lines 11–14), which removes a potential ReDoS.
- **Number.**
  - Formatting is display only. It never changes the stored value.
  - Lenient parsing reads "12%" as 0.12, and a percent-formatted field reads "12" as 0.12.
  - Teable's parser deletes every character that is not a digit, `.`, `+` or `-`, so "1,5" becomes 15 and "1e3" becomes 13. **Do not copy this.** Use a locale-aware parser that refuses anything ambiguous.
- **Date.**
  - Parse in this order: an exact ISO string; then strict parsing with the field's own format (date, plus time if the text has one); then interpretation in the field's time zone; refuse otherwise. `now` resolves to the current time.
  - Islestone stores `@db.Date`, so for it "parse" means "a calendar date in the workspace or field time zone".
- **Checkbox.** Teable stores only `true`; `false` is normalised to null. Adopting this gives Islestone one representation of "unchecked", namely no row. Then "is false" is `NOT EXISTS`, which matches how Teable's SQL treats false or null (visitor line 1953). This needs an owner decision (open question 3).
- **Person.**
  - Text input matches a member by id, name or email.
  - Teable's code takes the **first** match even though its comment promises "exactly one" (`user.field.ts` lines 35–36 against 57–63). Islestone must refuse an ambiguous name.
  - The `me` default resolves to the actor when the item is created.
- **URL.**
  - Teable deprecated its URL display type. URLs inside text are auto-detected instead (`show-as/text.ts` lines 4–5). It also validates no URL scheme anywhere.
  - Islestone keeps `URL` as a type (ADR 0002), so it must validate it itself: absolute URL, scheme `http` or `https` only, length cap. A `javascript:` value must never become a link.

### 5.3 The operator matrix by type

Teable picks operators first by value type, then adjusts by field type (`getValidFilterOperators`, `operator.ts` lines 392–483). Translated to Islestone's eight types:

| Islestone type | Operators |
|---|---|
| TEXT, URL | is, isNot, contains, doesNotContain, isEmpty, isNotEmpty |
| NUMBER | is, isNot, isGreater, isGreaterEqual, isLess, isLessEqual, isEmpty, isNotEmpty |
| CHECKBOX | is (true or false) |
| DATE | is, isNot, isWithIn, isBefore, isAfter, isOnOrBefore, isOnOrAfter, isEmpty, isNotEmpty; each takes a date mode (5.5) |
| SELECT | is, isNot, isAnyOf, isNoneOf, isEmpty, isNotEmpty (Teable takes the text set, drops contains and doesNotContain, and adds isAnyOf and isNoneOf) |
| MULTI_SELECT | hasAnyOf, hasAllOf, isExactly, isNotExactly, hasNoneOf, isEmpty, isNotEmpty |
| PERSON (single) | is, isNot, isAnyOf, isNoneOf, isEmpty, isNotEmpty; the value may be the token `Me` |

Value shape is checked by operator:

- isEmpty and isNotEmpty require a null value.
- The set operators (isAnyOf, isNoneOf, hasAnyOf, hasAllOf, hasNoneOf, isExactly, isNotExactly) require a non-empty array.
- Every other operator requires a scalar.

Date operators require a `{mode, …, timeZone}` object, and the mode must be allowed for that operator. `dateRange` is allowed only with `is`.

### 5.4 Filter tree validation

Validation walks the tree with a path of child indexes and returns structured issues instead of throwing. Each issue carries a code (`FIELD_NOT_FOUND`, `OPERATOR_NOT_ALLOWED`, `MODE_NOT_ALLOWED`, `VALUE_SHAPE_INVALID`), the path, the field id and a message. This is the right contract for Islestone's API. It is also the right contract for 7.3, where a model emits a filter and the server explains precisely what it refused.

```
validate(node, path):
  if node is Condition:
    f = fields[node.fieldId]                    else issue FIELD_NOT_FOUND
    op ∈ OPERATORS[f.type]                      else issue OPERATOR_NOT_ALLOWED
    shapeOk(op, node.value)                     else issue VALUE_SHAPE_INVALID
    if f.type = DATE and value ≠ null: value.mode ∈ MODES[op]   else issue MODE_NOT_ALLOWED
    if f.type ∈ {SELECT, MULTI_SELECT}: every optionId belongs to f      (Islestone addition)
    if f.type = PERSON: every userId is a member of the workspace, or is the token Me   (Islestone addition)
  else:
    depth(path) ≤ 5 and count(conditions) ≤ 100    (Teable's caps)
    for i, child in node.filterSet: validate(child, path + [i])
```

Teable keeps a condition whose value is null ("in progress": the user has picked a field and an operator but no value) and skips it at query time. Islestone should refuse such a condition at save, and skip it only in the unsaved editor state.

**Merging.** The saved view's filter is AND-ed with an ad-hoc query filter by wrapping both in a new AND node. Sorts merge with the query's items first, keeping each field once, and a manual sort with no query sort means no sort. Both behaviours are sound to adopt.

### 5.5 Relative date ranges

Teable resolves a mode into an inclusive `[start, end]` range in the filter's time zone (adapter lines 660–840). The operator then compares against it:

- is: within the range;
- isNot: outside the range, **or empty**;
- isBefore: earlier than the start;
- isOnOrAfter: on or after the start;
- isAfter: later than the end;
- isOnOrBefore: on or before the end;
- isWithIn: within the range.

On Islestone's date-only column, compute calendar dates rather than instants:

```
today = calendarDate(now, tz)                  // tz: the workspace's, or the view's stored zone
today | tomorrow | yesterday           → [d, d] with d = today + 0 | +1 | −1 days
oneWeekAgo | oneWeekFromNow            → [d, d] with d = today ∓ 7 days
oneMonthAgo | oneMonthFromNow          → [d, d] with d = today ∓ 1 month (end-of-month clamped)
daysAgo n | daysFromNow n              → [d, d] with d = today ∓ n days
currentWeek | currentMonth | currentYear → [startOf(unit, today), endOf(unit, today)]
lastWeek | nextWeekPeriod (and month, year) → the same, for the unit shifted by −1 or +1
pastWeek | pastMonth | pastYear        → [today − 1 unit, today]   (isWithIn only)
nextWeek | nextMonth | nextYear        → [today, today + 1 unit]   (isWithIn only)
pastNumberOfDays n                     → [today − n, today];  nextNumberOfDays n → [today, today + n]
exactDate d                            → [d, d];  dateRange (a, b) → [a, b] (with is only; refuse a > b)
```

Three implementation hazards Teable documents or exhibits:

1. **A zero-offset bug in dayjs's time-zone plugin.** It gave host-dependent day boundaries in UTC and London in winter (adapter lines 312–321). Islestone should do this arithmetic with `Temporal.PlainDate`, or on plain date strings, and never with host-local `Date`.
2. **The week start is a process-wide mutation.** Teable calls `dayjs.updateLocale(…, {weekStart: 1})` on every request (line 766). Islestone should make the week start a workspace setting passed in explicitly.
3. **Silent no-ops.** An inverted `dateRange` returns `true`, which matches every row (line 914). `dateRange` with `isNot` is skipped the same way (line 1080). Refuse both at validation instead.

### 5.6 Negative operators and sets over Islestone's typed value table

Teable's rule, kept "for v1 parity": a **negative** operator also matches **empty** values.

- isNot, doesNotContain, isNoneOf, hasNoneOf and isNotExactly all include rows with no value (adapter lines 1093–1097, 1277–1281, 1571, 1579–1581).
- isEmpty on text also matches `''`.

Adopt the rule explicitly, and test it. Over `V(item, f)`, the value rows of field `f` on item `item`:

```
is x            : EXISTS V where col = x
isNot x         : NOT EXISTS V where col = x                    -- includes empty
contains t      : EXISTS V where textValue ILIKE '%' || likeEscape(t) || '%'
doesNotContain t: NOT EXISTS V where textValue ILIKE …          -- includes empty
isGreater n     : EXISTS V where numberValue > n                -- likewise ≥, <, ≤
isAnyOf S / hasAnyOf S : EXISTS V where optionId ∈ S             (userId for PERSON)
isNoneOf S / hasNoneOf S: NOT EXISTS V where optionId ∈ S        -- includes empty
hasAllOf S      : (SELECT count(DISTINCT optionId) FROM V WHERE optionId ∈ S) = |S|
isExactly S     : hasAllOf S AND NOT EXISTS V where optionId ∉ S
isNotExactly S  : NOT isExactly S                                -- includes empty
isEmpty         : NOT EXISTS V;     isNotEmpty: EXISTS V
CHECKBOX is true: EXISTS V where boolValue;   is false: NOT EXISTS V   (if unchecked = no row)
```

Each `EXISTS` is a correlated subquery on `CustomFieldValue`, and is served by the ADR's `[tenantId, fieldId, <valueColumn>]` indexes. Prisma's `some`, `none` and `every` relation filters produce the same shapes, so most of this needs no raw SQL. Sorting by a custom field is a `LEFT JOIN` to its value row; for MULTI_SELECT, use the lowest option position. Put empty values last in both directions, and decide that explicitly; Teable has no such rule in the read code.

### 5.7 Keeping saved views correct when a field changes (v2 `filter-sync.ts`)

When a field is updated, the change is first summarised into a plan, then every stored filter is rewritten.

```
plan = { dropConditionsOnField: typeChanged,
         renamed: Map(oldName → newName), removed: Set(optionName),
         personMultiplicity?: single→multiple | multiple→single }
rewrite(node):
  Condition on another field → keep
  Condition on this field:
     typeChanged → drop
     person multiplicity changed → remap the operator (is→isExactly, isAnyOf→hasAnyOf, …; reverse
                                   hasAllOf→is); no mapping → drop
     filter values: remove the removed values, rename the renamed ones; if a list becomes empty → drop
  Group → rewrite the children; an empty group → drop
```

For Islestone:

- **Renames need no rewrite.** Values and filters hold option ids, not names. That is the main advantage of ADR 0002's FK design over Teable's name-keyed design.
- **Removals still need the plan**, and Teable's "drop the condition" is wrong in one direction:
  - Dropping a condition from an AND group widens the view. With `stage isAnyOf [X]`, deleting X turns "items in X", which is now none, into "all items".
  - Dropping from an OR group narrows it.
- **Recommendation:** give `CustomFieldOption` an `archivedAt`, the same as `CustomField`. An archived option keeps its values and stays valid in filters; only new writes refuse it. A hard delete then runs only when no value or filter references the option. Otherwise it is refused with the list of views that still use it.
- Changing a field's type should be its own usecase and needs an ADR decision. Teable allows it and converts values through `repair()`. Islestone's composite FK on `(fieldId, type)` makes the type immutable unless the change is explicitly migrated.
- The `Me` token (`currentUserFilterValue`) is resolved to the reader's user id at query time, so one shared view, "assigned to me", works for everyone. Adopt it for PERSON filters, and for the built-in assignee, creator and delegate filters too (2.7 My Work).

### 5.8 Caps (from `TableDataSafetyLimits.ts`)

| Teable cap | Value | Islestone recommendation |
|---|---|---|
| fields per table | 500 | **50 custom fields per project** (smaller grain) |
| choices per select | 1,000 | **200** |
| choice name length | 1,000 | **100** |
| default values per select | 100 | |
| filter conditions | 100 | **100**, enforced in the Zod schema |
| filter depth | 5 | **5**, enforced in the Zod schema |
| sort items | 20 | **5** |
| group items | 3 | **1** (board grouping) or **3** (list), per layout |
| views per table | 100 | |
| options JSON | 256 KiB | |
| formula length | 8,192 | |

All of these caps are owner-tunable. Keeping the bounds in the schema keeps both the saved JSON and the generated query bounded.

### 5.9 Search predicate (feeds 2.7)

`FieldCore.isSearchable` and `matchSearch` (`field.ts` lines 114–157) are shared by the server and the client, so search and highlighting cannot drift apart:

- boolean values are never searchable;
- an all-fields search skips dates, and skips numbers when the keyword is not numeric;
- matching is a case-insensitive substring match on the display text.

Islestone can use the same predicate to decide which custom-field values join item search, subject to ADR 0002 section 11 (only unencrypted values are searchable).

### 5.10 Formula engine (deferred; no current sub-phase)

- **Parse.** An ANTLR grammar with precedence levels:
  - `* / %`; `+ -`; comparisons; `= !=`; `&&`; `||`; `&` (concatenation);
  - literals, parentheses, unary minus, `{fieldId}` references, `NAME(args)`;
  - comments and whitespace are their own nodes.
- **Types.** The visitor returns a typed value `{value, type, isMultiple, field?, isBlank?}`. Without a record, it returns only the type, which is how a formula field's value type is inferred when the field is defined. With a record, it evaluates.
  - `+` is numeric when both sides are numbers and string concatenation otherwise. `-`, `*`, `/` and `%` are numeric; division or modulo by zero gives null. Comparisons and logical operators are boolean.
  - A multi-valued number with more than one element is refused in arithmetic.
  - Each function declares the value types it accepts, whether it accepts multiple values, `validateParams` and `getReturnType(params)`. Arguments outside the accepted types are coerced to strings first.
- **References.** Formulas store field ids. They are shown with names through a name↔id rewrite that re-emits every other token verbatim. References are extracted with the **lexer only**, so strings and comments stay opaque and a malformed formula cannot recurse into the parser.
- **Cycles.** Dependency edges are typed (same record or across records). Expansion keeps a stack and throws a cycle error carrying the whole chain (A → B → A). This matches ADR 0002's rule for refusing cycles. If formulas arrive, Islestone would refuse the cycle when the field is saved, as it does for `BLOCKS`.
- **SQL.** `formula-sql-pg` (~10,000 lines) compiles the abstract syntax tree to Postgres, sharing common subexpressions through materialised CTEs under a compile budget (at most 96 CTEs). Literals are escaped by doubling quotes (`PgSqlHelpers.ts` lines 14–24), which is correct only while `standard_conforming_strings` is on. An Islestone port would bind parameters instead.
- **Verdict.** Out of scope for 2.4. A "formula field" needs its own ADR on several points:
  - in-memory or SQL evaluation;
  - when values recompute;
  - what an agent may write;
  - `REGEXP_REPLACE`'s ReDoS exposure;
  - the ANTLR runtime: `antlr4ts` has been alpha since 2021; `antlr4` or `antlr4ng` are the alternatives.

  Roadmap 2.3 already names Univer (Apache-2.0) as the fallback "if formulas are needed".

## 6. Mapping onto Islestone's roadmap and ADRs

| Teable part | Islestone target | ADR fit |
|---|---|---|
| Type registry, options, value rules (5.1, 5.2) | **2.4** `CustomField`, `CustomFieldOption`, `CustomFieldValue` usecases and the Zod schemas | ADR 0002 section 7. Adopt the rules; keep Islestone's typed table, FKs and the CHECK |
| Operator matrix, filter tree, validation, merge (5.3, 5.4) | **2.4** `SavedView.filters`; the existing filter system (inflect-compliance pattern) | ADR 0002 section 13 indexes; ADR 0006: say "field" and "option", never "column", "property" or "choice" |
| Relative date modes (5.5) | **2.4** view filters; **2.7** My Work "due soon"; **3.3** calendar | Needs a workspace time zone and week start (new settings) |
| Negative-operator and set semantics over `EXISTS` (5.6) | **2.4** repository query builder; **H2** performance gate | ADR 0002 section 13 `[tenantId, fieldId, value]` indexes |
| Filter sync, option archiving, `Me` (5.7) | **2.4** field and option update usecases; **2.7** My Work | Proposes an amendment to ADR 0002 section 7: `CustomFieldOption.archivedAt`; an immutable type, or an explicit conversion usecase |
| Column meta, kanban `stackFieldId`, group cap (section 4) | **2.3** board swimlanes "by any field"; **2.4** visible columns | ADR 0002 section 5 (`sortKey` is the single manual order; per-view order is a "what would change" item) |
| Caps (5.8) | **2.4** schemas; **H2** fuzzing | |
| `fromText` lenient parsing, `IMPORT_SUPPORTED_TYPES` | **5.5** importers; **2.3** paste into the list | Lenient path only behind an importer's dry run |
| Search predicate (5.9) | **2.7** | ADR 0002 section 11 (S1: unencrypted only) |
| Query DSL `Query.g4` | **7.3** natural-language views, as the model's output language, validated by 5.4 | ADR 0003: a model proposes a view; it never writes one |
| Custom-field writes by agents | **6.2** proposals | ADR 0003: proposals record version and field values; ADR 0002 section 9 bumps `version` on a value change |
| Teable's ShareDB realtime (`Ops`, `adapter-realtime-sharedb`) | none | **Contradicts ADR 0005** (server-authoritative, change notices). Do not take |
| Formula engine (5.10) | none (would be a new sub-phase and ADR) | |

## 7. What Islestone must NOT take

**Copyleft or closed, by licence:**

- `apps/nestjs-backend`, `apps/nextjs-app`, `plugins/`: AGPL-3.0 with the Section 7(e) brand terms. This includes the v1 services that implement option renames, type conversion and filter → SQL over cells, and the field and view controllers. Inspiration only, and in this study not read at all beyond their licence.
- Root-level files outside `packages/` (`scripts/`, `dockers/`, `static/`, `dottea/`, `Makefile`, `.github/`, `docker-bake.hcl`, `agents.md`): treat as AGPL.
- `enterprise/`: closed, and not in the tree.
- **Any revision of `packages/` before `9c77957af` (2024-08-19).** It was AGPL then.

**Brand, by trademark and the stated term:**

- `packages/icons/src/components/TeableAi.tsx`, `TeableNew.tsx`;
- any Teable name, logo or colour identity;
- the `app.teable.ai` link in `FILTER_DESCRIPTION`;
- the Teable-branded strings in `packages/common-i18n` locales.

The MIT text grants no trademark rights. Name Teable only in attribution.

**Designs that contradict Islestone's ADRs** (MIT, but wrong for Islestone):

- one physical column per field and DDL per field;
- JSON multi-values;
- select values keyed by name;
- user snapshots inside cells;
- `preventAutoNewOptions` auto-creation on ordinary writes;
- ShareDB operation logs.

**Quirks that must not be copied:**

- `parseStringToNumber`'s naive stripping (5.2);
- the first-match person resolution (5.2);
- the global `dayjs.updateLocale` call (5.5);
- inverted or `isNot` date ranges silently matching every row (5.5);
- dropping removed-option conditions, which widens AND groups (5.7);
- `stripFilterByReadableFieldIds` dropping unreadable conditions from saved views, which widens AND groups the same way (`filter.ts` lines 147–186). Row reads stay authorised, but the view's meaning changes;
- `console.error` in `formula/src/conversion.visitor.ts`, which Islestone's lint bans.

## 8. Attribution Islestone would have to carry

**If code is copied or adapted** from any MIT package, add this to `NOTICE`. A "substantial portion" includes translated schemas or tests. MIT requires the copyright and permission notice "in all copies or substantial portions".

```
Teable packages (packages/core, packages/v2/*, packages/formula)
Source: https://github.com/teableio/teable, commit bd8cfc054f521f6f9019f62dec2f9fcb1273ecec
Files: <list the exact files adapted>
Copyright (c) 2023-2025 Teable, Inc.
License: MIT

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The `v2/*` and `formula` packages have no LICENSE file of their own. The text above is `packages/core/LICENSE`, which the root `LICENSE` designates for every package. Cite both files in the `PROVENANCE.md` row.

**Additionally, only if the formula grammar or its generated parser is ported:**

```
Portions based on Baserow software. Copyright (c) 2019-present Baserow B.V. License: MIT.
Formula lexer: Copyright 2018 Tal Shprecher. License: MIT.
(Each followed by the MIT permission notice above.)
```

**If only patterns are taken** (the recommended route for 2.4, since Islestone's storage differs), no `NOTICE` entry is legally required. Still record it in `PROVENANCE.md`:

| Component | Source (repository and path) | Commit | Licence | What was taken | Changes |
|---|---|---|---|---|---|
| Custom-field type rules, filter operator matrix, filter tree validation, date modes, filter sync on option change (2.4) | `github.com/teableio/teable`: `packages/core/src/models/field/**`, `packages/core/src/models/view/**`, `packages/v2/core/src/domain/table/fields/filter-sync.ts`, `user-filter-operator-remap.ts`, `packages/v2/core/src/domain/shared/TableDataSafetyLimits.ts`, `packages/v2/adapter-table-repository-postgres/src/record/visitors/TableRecordConditionWhereVisitor.ts` (semantics only) | `bd8cfc054f521f6f9019f62dec2f9fcb1273ecec` | MIT (`packages/core/LICENSE`; root `LICENSE` item 2 for `packages/v2`, which has no LICENSE file) | Pattern only, no code copied | Typed value table with FKs instead of physical columns; option ids instead of names; option archiving instead of filter-dropping; strict and lenient parsing split; date-only arithmetic; Islestone caps |

Then move the Teable row in `PROVENANCE.md` from "Port candidates" to "Adopted" in the same pull request, and replace UNPINNED with the commit above.

## 9. Open questions for the owner

1. Is the relicence of pre-2024 contributions sufficient (no CLA found)? Optional: ask Teable (`support@teable.ai`, from root `LICENSE`) to confirm, and to add LICENSE files to `packages/formula` and `packages/v2/*`.
2. ADR 0002 amendment: `CustomFieldOption.archivedAt`, and refusing a hard delete while the option is referenced (5.7).
3. CHECKBOX storage: only `true` rows, so unchecked means no row (5.2)?
4. Can a custom field's type ever change? If so, an explicit conversion usecase with a dry run (5.7).
5. PERSON multiplicity: ADR 0002 allows one `userId` per item and field. Teable supports multiple. Single only for 2.4?
6. A workspace time zone and week start, needed by date filters (5.5).
7. Whether to port Teable's MIT tests as test cases. That counts as copying and triggers the `NOTICE` entry, or they can be rewritten from the behaviour described here.

## Licence check

**CORRECTED.** An independent check on 2026-11-18 by a second agent, done by reading files only. Nothing in the clone was run. The main finding stands: everything under `packages/` is MIT from `9c77957af` (2024-08-19) onwards, the apps, `plugins/` and the root are AGPL-3.0 with the root `LICENSE`'s Section 7(e) brand term, and the pin qualifies. Five details in section 1 were wrong and are fixed above.

**What was checked:**

- **Pin.** The clone's HEAD is `bd8cfc054f521f6f9019f62dec2f9fcb1273ecec`, and `git ls-remote` showed it as the head of `refs/heads/develop` when this check ran.
- **Upstream copies.** These files were fetched from `https://raw.githubusercontent.com/teableio/teable/bd8cfc054f521f6f9019f62dec2f9fcb1273ecec/<path>` (all HTTP 200) and are byte-identical to the clone:
  - `LICENSE` (sha1 `2db33c2d…`);
  - `AGPL_LICENSE` (sha1 `ba53934a…`);
  - `packages/core/LICENSE` (sha1 `4acf799f…`);
  - `plugins/LICENSE` (sha1 `a2f9ffbf…`).
- **Missing licence files.** The same URL returned 404 for `packages/formula/LICENSE`, `packages/v2/core/LICENSE`, `packages/i18n-keys/LICENSE` and `packages/db-data-prisma/LICENSE`. The files really are absent upstream; the clone is not missing them.
- **Root `LICENSE`.** Read in full. Item 1 puts AGPL-3.0 on `apps/nestjs-backend` and `apps/nextjs-app`. Item 2 says every package under `packages/` is MIT. The project "as a whole" is AGPL-3.0, with the 7(e) brand term.
- **Eight per-package MIT files.** `common-i18n`, `core`, `db-main-prisma`, `eslint-config-bases`, `icons`, `openapi`, `sdk` and `ui-lib` each have a `LICENSE` with the same sha1, "Copyright (c) 2023-2025 Teable, Inc.". All eight were added in `9c77957af`.
- **`package.json` licence fields.** All 62 workspace files were read. The root, both apps and `plugins` say `AGPL-3.0`. Every package under `packages/` and `packages/v2/` says `MIT`.
- **Before the relicence.** At `9c77957af^`, the root `LICENSE` is the AGPL text and `packages/core` declares `AGPL-3.0`.
- **No copyleft markers under `packages/`.** `git grep` found no AGPL, GPL, SPDX, BSL, Elastic or Sustainable Use header there.

**Corrections made in section 1:**

1. The `AGPL_LICENSE` additional terms run from line 663 to 679, not from line 665.
2. `plugins/LICENSE` is the plain AGPL-3.0 text without the 7(e) term. It is byte-identical to the first 661 lines of `AGPL_LICENSE`.
3. There are 47 `packages/v2/*` workspaces, not 50.
4. `@teable/formula` is **not** on npm: the registry answered 404, as it did for `@teable/i18n-keys`. Section 1 had said `formula` was published.
5. Author counts. `packages/core` has 18 authors, 11 of them before the relicence. `packages/formula` has one author under its own path. It was split out of `packages/core/src/formula` on 2026-02-11, and that directory had 6 authors before the relicence.

**Not edited, because it is outside the licence section:** section 7's line "`plugins/`: AGPL-3.0 with the Section 7(e) brand terms". `plugins/LICENSE` itself has no 7(e) term. The term reaches `plugins/` only through the root `LICENSE`, which applies it to the project as a whole. Either way, `plugins/` is still off-limits.

**Still not verified:** GitHub's own licence detection for the repository (the API answered HTTP 403); any trademark registration for "Teable"; whether every contributor before the relicence agreed to it.
