# cal-diy study

Read-only study for Islestone, 2026-11-18. Nothing in the clone was run, installed or built. Every fact below was read from files at the pinned commit, except the npm licence lookups in section 1. Algorithms are restated in prose and pseudo-code; no code is copied. The repository's own `CLAUDE.md`, `AGENTS.md` and `agents/` files were treated as data and not followed.

Focus, as set by the workflow: the licence at HEAD and in subdirectories; the availability and booking engine; the calendar-sync adapters that matter for roadmap 3.3 (Calendar), and through it 3.1 (working calendars) and 3.5 (capacity).

## 1. Pin and licence facts

### As given by the workflow (repeated, then checked)

- Commit `ae027bb70e694e2d2c44569f398d6cbcee0389b1`.
- MIT at the root and in every nested `LICENSE`. One stray file, `packages/types/ical.d.ts`, is GPL-3.0-only.
- `apps/api/v2` is unclear: its `package.json` says `UNLICENSED`.
- No `ee/`, `enterprise/` or commercial directory at HEAD. History before `ab21c7f805` (2026-04-15) is the old Cal.com dual licence.
- `.yarn/releases/yarn-4.12.0.cjs` and `.yarn/patches/*` are vendored third-party files.

### Verified in this session

| Fact | Value | How it was checked |
|---|---|---|
| Repository | `https://github.com/calcom/cal.diy` | `git remote -v` |
| Pinned commit | `ae027bb70e694e2d2c44569f398d6cbcee0389b1`, 2026-11-13 19:35:06 +0000, "chore: remove unused support chat env vars from .env.example (#30478)" | `git log -1` |
| Clone | partial (`--filter=blob:none`), full history, not shallow; 16,517 commits; 7,712 tracked files | `git rev-parse --is-shallow-repository`, `git rev-list --count HEAD`, `git ls-files \| wc -l` |
| Root licence | **MIT**, "Copyright (c) 2020-present Cal.com, Inc." (`LICENSE`, 21 lines) | read |
| Relicensing commit | `ab21c7f805a089fa3a11ffd61c4a9aecc349c16c`, 2026-04-15, "refactor: Cal.diy (#28903)": the last change to `LICENSE` | `git log -- LICENSE` |
| Licence before it | `ab21c7f805^:LICENSE`: AGPLv3 overall; `packages/features/ee` and `apps/api/v2/src/ee` under the Cal.com Commercial License | read the header lines only |
| Nested `LICENSE` files | 6, each MIT with the same copyright line (22 lines): `apps/api/v2/src/platform/`, `packages/app-store/hitpay/`, `packages/app-store/stripepayment/`, `packages/embeds/embed-core/`, `embed-react/`, `embed-snippet/` | read each |
| `package.json` licence fields | `MIT` ×6 (`app-store/hitpay`, `app-store/stripepayment`, `config`, `i18n`, `lib`, `ui`); `SEE LICENSE IN LICENSE` ×3 (embeds); `ISC` ×1 (`apps/api/package.json`); `UNLICENSED` ×1 (`apps/api/v2/package.json`). Every other package has no field, so the root `LICENSE` governs | grep |
| SPDX headers | one file only: `packages/types/ical.d.ts`, "SPDX-License-Identifier: GPL-3.0-only", "© 2019 EteSync Authors" (269 lines) | grep; read its 3-line header only |
| Third-party marker in a recommended path | `packages/types/Calendar.d.ts` line 328 links a Stack Overflow answer for the one-line `Class<I, Args>` type helper at line 330 (line 332, `CalendarClass`, is Cal.diy's own use of it). Stack Overflow content is CC BY-SA, so do not copy it | grep for copyright, licence, SPDX, "adapted from", "stackoverflow" over every path in section 2 |
| `ee` folders | none: 0 tracked paths contain `ee/`. Three paths contain `enterprise`: `apps/web/app/(use-page-wrapper)/enterprise/page.tsx` (5 lines, no licence text) and two images, `apps/web/public/tips/enterprise.jpg` and `enterprise-dark.jpg` | `git ls-files` grep |
| Former `ee` code moved, not only removed | the relicensing commit deleted all 776 paths under `ee/` and added 239 files. 95 of the added files are byte-identical (same git blob id) to a file that sat under `ee/`, i.e. under the Cal.com Commercial License, one commit earlier: 91 in `apps/api/v2`, 3 in `packages/features/api-keys-legacy`, 1 in `apps/web/modules`. All 95 are still at HEAD. That is a lower bound: 181 added files share a basename with a deleted `ee` file, and an edited move has a different blob id. **None of the 63 paths recommended in section 2 is among them**; each of those already existed at the same non-`ee` path at `ab21c7f805^`, so before relicensing it was AGPLv3, not Commercial | `git ls-tree -r` blob ids at `ab21c7f805^` and `ab21c7f805`; `git diff --no-renames --name-status` |
| NOTICE file | none | `git ls-files` |
| README | "100% MIT-licensed with no proprietary 'Enterprise Edition'" (line 43); "no commercial/enterprise code" (line 660) | read |
| Contributor licence agreement | none found in `CONTRIBUTING.md`, `README.md` or `.github/` at HEAD, nor in `CONTRIBUTING.md` at `ab21c7f805^` | grep |

Runtime dependency licences of the calendar code, looked up on the npm registry at the exact versions the package files pin (`npm view <pkg>@<ver> license`):

| Package | Version | Licence | Islestone gate |
|---|---|---|---|
| `@googleapis/calendar` | 9.7.9 | Apache-2.0 | allowed |
| `google-auth-library` | 9.15.0 | Apache-2.0 | allowed |
| `tsdav` (CalDAV) | 2.0.3 | MIT | allowed |
| `ical.js` | 1.5.0 | MPL-2.0 | allowed for unmodified use only (`NOTICE_LICENCES`) |
| `ics` (iCalendar writer) | 2.37.0 | ISC | allowed |
| `rrule` | 2.7.1 | BSD-3-Clause | allowed |
| `dayjs` | 1.11.2 | MIT | allowed |
| `windows-iana` | 5.1.0 | MIT | allowed |

Islestone takes none of these by porting. Any it adopts goes through the 0.3 allowlist on its own.

### Not verified

- **Whether the April 2026 relicensing covers third-party contributions.** Until `ab21c7f8`, outside contributors committed under AGPLv3. The repository holds no contributor licence agreement, so it cannot show that Cal.com, Inc. had the right to relicense their code as MIT. The MIT grant is Cal.com, Inc.'s representation. Several files recommended below have many authors (`slots.ts`: 25 distinct author addresses in `git log`). This is an owner question (section 9). It is not legal advice.
- `apps/api/v2`: the `UNLICENSED` field against the MIT `src/platform/LICENSE`. Its source was not read. What is known: the package is `"private": true`, the field was introduced in `0a15483c46` (2024-03-20, under the old dual licence) and was not changed at relicensing, and the directory holds at least 91 files moved out of the former Commercial-licensed `ee` folders (row above). Which licence its authors intend is not settled by the files. Nothing below needs it: its slots and schedules services wrap the same `packages/*` logic.
- A rule of the form "only code-close adaptations of files added at or after `ab21c7f8`" would admit former Commercial-licensed `ee` code, because the moved files first appear at their current paths in that commit. Any such rule must use content history (blob ids before `ab21c7f8`), not path history.
- `.yarn/releases/yarn-4.12.0.cjs` (no header) and `.yarn/patches/*`. Not read.
- The upstream origin of `packages/dayjs/plugins/business-days-plugin.ts` (232 lines). The file credits nobody. It was added in `0a15483c46` (2024-03-20, "feat: platform atoms + api v2 (#14106)"). Treat it as Cal.diy's own, and re-check before translating it closely.
- Microsoft Graph and Google API behaviour quoted in section 7 comes from general knowledge of those APIs, not from documents read today. Each such line is marked.

## 2. Where the relevant code lives

Paths are relative to the repository root. Line counts are `wc -l` at the pinned commit; tests are listed separately.

### Schema

| Path | Lines | Content |
|---|---|---|
| `packages/prisma/schema.prisma` | 2,851 (100 models) | One file. Models used here: `Schedule` (945), `Availability` (960), `SelectedCalendar` (978), `DestinationCalendar` (351), `Credential` (308), `TravelSchedule` (387), `OutOfOfficeEntry` (1652), `OutOfOfficeReason` (1675), `UserHolidaySettings` (1686), `HolidayCache` (1698), `SelectedSlots` (1437), `BookingReference` (801), `Booking` (851), `EventType` (156), `CalendarCache` (1594), `CalendarCacheEvent` (2770); enums `PeriodType` (48), `BookingStatus` (843), `CalendarCacheEventStatus` (2764) |

### Availability engine (worth studying; translate, do not copy)

| Topic | Path (lines) | Islestone target |
|---|---|---|
| Weekly hours, date overrides, time off and travel → absolute ranges | `packages/features/schedules/lib/date-ranges.ts` (472): `processWorkingHours`, `processDateOverride`, `buildDateRanges`, `groupByDate`, `intersect`, `subtract`, `mergeOverlappingRanges` | 3.5 capacity; 3.1 working calendar |
| Interval helpers | `packages/features/availability/lib/getAggregatedAvailability/date-range-utils/mergeOverlappingDateRanges.ts` (36), `filterRedundantDateRanges.ts` (50); `packages/lib/intervalTree.ts` (94) | 3.5 |
| Which schedule applies, and in which time zone | `packages/features/availability/lib/detectEventTypeScheduleForUser.ts` (101) | 3.5 |
| Per-person availability orchestration | `packages/features/availability/lib/getUserAvailability.ts` (885): `_getUserAvailability` 361–667, `calculateOutOfOfficeRanges` 727–783, `calculateHolidayBlockedDates` 822–885 | 3.5 |
| UTC-encoded weekly hours to a zone | `packages/lib/availability.ts` (164): `getWorkingHours` | 3.5 (idea only) |
| Team aggregation | `packages/features/availability/lib/getAggregatedAvailability/getAggregatedAvailability.ts` (78) | 3.5 team view |
| Busy time from bookings, buffers, seats and calendars | `packages/features/busyTimes/services/getBusyTimes.ts` (501): `_getBusyTimes` 29–290 | 3.3 overlay; 3.5 |
| Per-period caps (count and duration) | `packages/lib/intervalLimits/limitManager.ts` (111), `intervalLimitSchema.ts` (14), `intervalLimit.ts` (17), `utils/getPeriodStartDatesBetween.ts` (27); `packages/features/busyTimes/lib/getBusyTimesFromLimits.ts` (315) | 3.5 over-allocation |
| Booking window rules (rolling days, business days, range) | `packages/lib/isOutOfBounds.tsx` (398): `calculatePeriodLimits` 26–166; `packages/dayjs/plugins/business-days-plugin.ts` (232) | 3.1 working-day arithmetic |
| Slot generation | `packages/features/schedules/lib/slots.ts` (264) | not needed; read for the alignment rules only |
| Slot orchestration | `packages/trpc/server/routers/viewer/slots/util.ts` (1,435): `_getAvailableSlots` 897–1300 | not needed (booking product) |
| Overlap test | `packages/features/bookings/lib/conflictChecker/checkForConflicts.ts` (50) | 3.5 |
| Holds and commit-time checks | `packages/trpc/server/routers/viewer/slots/reserveSlot.handler.ts` (126), `packages/features/bookings/lib/handleNewBooking/ensureAvailableUsers.ts` (265), `packages/lib/idempotencyKey/idempotencyKeyService.ts` (20), `packages/prisma/extensions/booking-idempotency-key.ts` (54) | idea only |
| Holidays | `packages/lib/holidays/HolidayService.ts` (274), `GoogleCalendarClient.ts` (95), `constants.ts` (265, country to Google holiday calendar id), `packages/features/holidays/repositories/HolidayRepository.ts` (216) | 3.1, 3.5 (source is an owner decision) |

### Calendar adapters and sync

| Topic | Path (lines) | Islestone target |
|---|---|---|
| Adapter contract | `packages/types/Calendar.d.ts` (337): `interface Calendar` 296–325, `CalendarFetchMode` 266–274, `GetAvailabilityParams` 279–285, `EventBusyDate` 56–62 | 3.3 port interface |
| Fan-out over a person's connections | `packages/features/calendars/lib/CalendarManager.ts` (581): `getBusyCalendarTimes` 296–358; `packages/features/calendars/lib/getCalendarsEvents.ts` (320) | 3.3 |
| Time zone normalisation | `packages/features/calendars/lib/timezone-conversion.ts` (43) | 3.3 |
| Subscription contract | `packages/features/calendar-subscription/lib/CalendarSubscriptionPort.interface.ts` (83) | 3.3 inbound |
| Subscribe, webhook, process events, rollout | `packages/features/calendar-subscription/lib/CalendarSubscriptionService.ts` (455) | 3.3 inbound |
| Google push channel and incremental sync | `packages/features/calendar-subscription/adapters/GoogleCalendarSubscription.adapter.ts` (216) | 3.3 inbound |
| Microsoft subscription and delta | `packages/features/calendar-subscription/adapters/Office365CalendarSubscription.adapter.ts` (262); `AdaptersFactory.ts` (70) | 3.3 inbound (read the defects in section 7 first) |
| Inbound changes to own events | `packages/features/calendar-subscription/lib/sync/CalendarSyncService.ts` (365) | 3.3 two-way |
| Busy-time cache | `.../lib/cache/CalendarCacheEventService.ts` (100), `CalendarCacheEventRepository.ts` (90), `CalendarCacheWrapper.ts` (220) | 3.3 overlay (optional) |
| Renewal batch query | `packages/features/selectedCalendar/repositories/SelectedCalendarRepository.ts` (516): `findNextSubscriptionBatch` 57–110 | 3.3 renewal job |
| Routes | `apps/web/app/api/webhooks/calendar-subscription/[provider]/route.ts` (90), `apps/web/app/api/cron/calendar-subscriptions/route.ts` (70), `.../calendar-subscriptions-cleanup/route.ts` (39) | shape only |
| OAuth token lifecycle | `packages/app-store/_utils/oauth/OAuthManager.ts` (631), `encodeOAuthState.ts` (21), `decodeOAuthState.ts` (35), `packages/app-store/_utils/invalidateCredential.ts` (21) | 3.3; hardening H3 "revoked tokens" |
| Google provider | `packages/app-store/googlecalendar/lib/CalendarService.ts` (998): `createEvent` 180–346, `fetchAvailabilityData` 648–702 (90-day chunking), `getAvailability` 704–727; `CalendarAuth.ts` (308) | 3.3 |
| Microsoft provider | `packages/app-store/office365calendar/lib/CalendarService.ts` (817): `fetchBusyTimes` 377–438, `fetchResponsesWithNextLink` 584–624, `fetchRequestWithRetryAfter` 626–672, `processBusyTimes` 706–723, `getMainTimeZone` 756– | 3.3 |
| CalDAV and Apple | `packages/lib/CalendarService.ts` (1,023): `getAvailability` 655–816; thin subclasses `packages/app-store/caldavcalendar/lib/CalendarService.ts` (18), `applecalendar/lib/CalendarService.ts` (18) | later |
| ICS feed | `packages/app-store/ics-feedcalendar/lib/CalendarService.ts` (318), `api/add.ts` (62) | later; see SSRF in section 7 |

### Tests worth translating as cases (MIT; inputs and expected outputs, not code)

| Path | Lines | What it pins |
|---|---|---|
| `packages/features/schedules/lib/date-ranges.test.ts` | 1,262 | DST start and end, travel schedules, full-day and partial overrides, an override already on the next UTC day, time off, availability past midnight, `intersect` and `subtract` edge cases (touching ranges, containment, unsorted input, 4-person teams) |
| `packages/features/schedules/lib/slots.test.ts` | 1,187 (48 cases) | half-hour time zones (Asia/Kolkata), cross-zone time off |
| `packages/lib/isOutOfBounds.timezone.test.ts` | 659 (22 cases) | booking windows across zones |
| `packages/features/schedules/hooks/useTimesForSchedule.timezone.test.ts` | 634 (19 cases) | wall-clock times across zones |
| `packages/features/availability/lib/getAggregatedAvailability/getAggregatedAvailability.test.ts` | 523 (12 cases) | fixed and round-robin hosts |
| `packages/features/calendar-subscription/lib/sync/__tests__/CalendarSyncService.test.ts` | 530 (21 cases) | own-event filter, owner check, echo suppression |
| `packages/features/calendar-subscription/lib/__tests__/CalendarSubscriptionService.test.ts` | 575 | error counters, flags |
| `packages/features/busyTimes/services/getBusyTimes.test.ts` | 400 (15 cases) | buffers, seats, reschedule |

## 3. Data model (transcribed compactly)

Notation: `field Type` with `?` for nullable; `→` is a foreign key with its delete rule; `[...]` lists unique and index keys. Every id is an integer unless marked `uuid`. No table has a tenant column: Cal.diy scopes by `userId` or `teamId`.

```
User (subset)      timeZone String = "Europe/London", weekStart String = "Sunday", bufferTime Int = 0,
                   defaultScheduleId Int? (no FK declared), schedules[], availability[], travelSchedules[],
                   selectedCalendars[], destinationCalendar?

Schedule           id, userId → User (cascade), name, timeZone String?
                   ← Availability[], EventType.scheduleId, EventType.restrictionScheduleId, Host.schedule
                   [idx userId]

Availability       id, userId? → User (cascade), eventTypeId? → EventType, scheduleId? → Schedule,
                   days Int[] (0 = Sunday … 6), startTime TIME, endTime TIME, date DATE?
                   One row is EITHER a weekly rule (days set, date null) OR a date override (date set).
                   An override with startTime = endTime blanks the whole day.
                   TIME values are wall-clock in the schedule's zone, read back as 1970-01-01Thh:mm UTC.
                   [idx userId] [idx eventTypeId] [idx scheduleId]

TravelSchedule     id, userId → User (cascade), timeZone, startDate, endDate?, prevTimeZone?
                   [idx startDate] [idx endDate]

OutOfOfficeEntry   id, uuid unique, start, end, notes?, showNotePublicly = false,
                   userId → User (cascade), toUserId? → User (cascade; redirect bookings to),
                   reasonId? → OutOfOfficeReason (set null), createdAt, updatedAt
                   [idx uuid] [idx userId] [idx toUserId] [idx start, end]
OutOfOfficeReason  id, emoji, reason unique, enabled = true, userId? → User (cascade; null = global)

UserHolidaySettings id, userId unique → User (cascade), countryCode?, disabledIds String[]
HolidayCache       uuid id, countryCode, calendarId, eventId, name, date, year
                   [unique countryCode, eventId] [idx countryCode, year] [idx countryCode, date]   (global rows)

EventType (subset) length Int (minutes), offsetStart = 0, slotInterval?, minimumBookingNotice = 120,
                   beforeEventBuffer = 0, afterEventBuffer = 0, seatsPerTimeSlot?,
                   periodType PeriodType = UNLIMITED (UNLIMITED | ROLLING | ROLLING_WINDOW | RANGE),
                   periodDays?, periodCountCalendarDays?, periodStartDate?, periodEndDate?,
                   bookingLimits Json?, durationLimits Json?   -- { PER_DAY?, PER_WEEK?, PER_MONTH?, PER_YEAR? }
                   scheduleId? → Schedule, restrictionScheduleId? → Schedule, timeZone?,
                   useEventLevelSelectedCalendars = false, showOptimizedSlots?, onlyShowFirstAvailableSlot

Booking (subset)   id, uid unique, idempotencyKey String? unique, userId? → User (cascade),
                   eventTypeId? → EventType, startTime, endTime,
                   status BookingStatus = ACCEPTED (CANCELLED | ACCEPTED | REJECTED | PENDING | AWAITING_HOST),
                   iCalUID String = "", iCalSequence Int = 0, fromReschedule?, rescheduled?,
                   references BookingReference[]
                   [idx startTime, endTime, status] [idx userId, status, startTime] [idx userId, endTime]
BookingReference   id, type (integration slug), uid (the provider's event id), externalCalendarId?,
                   thirdPartyRecurringEventId?, bookingId? → Booking (cascade),
                   credentialId? → Credential (set null), delegationCredentialId? (set null), deleted?
                   [idx bookingId] [idx type] [idx uid]
SelectedSlots      id, eventTypeId, userId, slotUtcStartDate, slotUtcEndDate, uid (booker cookie),
                   releaseAt, isSeat = false            -- a short hold; no FKs
                   [unique userId, slotUtcStartDate, slotUtcEndDate, uid]

Credential         id, type (e.g. "google_calendar"), key Json, encryptedKey String?,
                   userId? → User (cascade), teamId? → Team (cascade), appId? → App(slug),
                   invalid Boolean = false, delegationCredentialId?
                   [idx appId] [idx invalid] [idx userId, delegationCredentialId] [idx teamId]
SelectedCalendar   uuid id, userId → User (cascade), integration, externalId,
                   credentialId? → Credential (cascade), eventTypeId? → EventType, delegationCredentialId?,
                   -- push channel
                   channelId?, channelKind?, channelResourceId?, channelResourceUri?, channelExpiration?,
                   -- sync state
                   syncSubscribedAt?, syncSubscribedErrorAt?, syncSubscribedErrorCount = 0,
                   syncToken?, syncedAt?, syncErrorAt?, syncErrorCount = 0,
                   -- older watch bookkeeping
                   error?, lastErrorAt?, watchAttempts = 0, unwatchAttempts = 0, maxAttempts = 3,
                   googleChannelId/Kind/ResourceId/ResourceUri/Expiration (5 deprecated columns)
                   [unique userId, integration, externalId, eventTypeId]   -- NULL eventTypeId is not distinct;
                                                                           -- the schema comment admits duplicates
                   [unique googleChannelId, eventTypeId] [idx userId] [idx externalId] [idx eventTypeId]
                   [idx credentialId] [idx channelId] + two composite watch/unwatch indexes
DestinationCalendar id, integration, externalId, primaryEmail?, userId? unique, eventTypeId? unique,
                   credentialId? → Credential (cascade), customCalendarReminder?   -- where new events go
CalendarCacheEvent uuid id, selectedCalendarId → SelectedCalendar (cascade), externalId, externalEtag,
                   iCalUID?, iCalSequence = 0, summary?, description?, location?, start, end,
                   isAllDay = false, timeZone?, status (confirmed | tentative | cancelled),
                   recurringEventId?, originalStartTime?, externalCreatedAt?, externalUpdatedAt?
                   [unique selectedCalendarId, externalId] [idx start, end, status] [idx selectedCalendarId, iCalUID]
CalendarCache      (legacy) PK (credentialId, key), value Json, expiresAt, userId?
```

Relations in one line each: User 1–* Schedule 1–* Availability; User 1–* TravelSchedule, OutOfOfficeEntry, Credential, SelectedCalendar; User 1–1 UserHolidaySettings; Credential 1–* SelectedCalendar 1–* CalendarCacheEvent; Booking 1–* BookingReference *–1 Credential; EventType *–0..1 Schedule.

### What an Islestone schema would look like (illustrative, for 3.3 and 3.5)

Each table gets `tenantId`, a tenant-leading index, RLS in its migration, `@@unique([id, tenantId])` and composite child keys (ADR 0002 section 10).

```
WorkingSchedule        id, tenantId, memberId, name, timeZone (IANA, required), isDefault
WorkingHoursRule       tenantId, scheduleId, weekday 0..6, startMinute 0..1440, endMinute 0..1440  CHECK start < end
WorkingDateException   tenantId, scheduleId, date DATE, startMinute?, endMinute?   -- both null = unavailable
TimeOff                tenantId, memberId, startsAt, endsAt, reasonCode, note (encrypted)?, coverMemberId?
TimeZoneTravel         tenantId, memberId, timeZone, startDate DATE, endDate DATE?
HolidaySetting         tenantId, memberId | teamId, countryCode, disabledHolidayIds[]   -- holiday data itself: section 9
CalendarConnection     inflect-compliance's UserCalendarConnection (copyable under ADR 0001 D1)
CalendarSubscription   tenantId, connectionId, externalCalendarId, channelId (unique), channelSecretHash,
                       resourceId?, expiresAt, renewAfter, syncCursor (encrypted), syncedAt?,
                       consecutiveErrors, lastErrorCode?, state (ACTIVE | NEEDS_FULL_SYNC | PAUSED | REVOKED)
CalendarEventMapping   inflect-compliance's UserCalendarEventMapping, plus lastPushedVersion Int and
                       lastSeenRemoteEtag?   -- the inbound match key (section 5.4)
ExternalBusyBlock      (only if an overlay is built) tenantId, subscriptionId, externalEventId, start, end,
                       isAllDay, showAs                         -- no summary, description or location
```

Cal.diy's `channel*` and `sync*` columns move to their own table because one connection holds several calendars, and Islestone's `TIME` columns become integer minutes so no reader has to decode "UTC as wall clock".

## 4. Algorithms

### 4.1 Which schedule and which zone (`detectEventTypeScheduleForUser.ts`)

```
schedule := eventType.schedule ?? hostSchedule(user) ?? user's default schedule
            ?? built-in Mon–Fri 09:00–17:00
zone     := schedule.timeZone ?? eventType.timeZone ?? user.timeZone
travel   := applied only when the chosen schedule is the user's default
```

`getUserAvailability` adds one step: when no schedule set a zone, it reads the zone from a delegated calendar connection before falling back to the schedule's.

### 4.2 Weekly hours to absolute ranges (`processWorkingHours`)

For each calendar day from the start of the query (in the organiser's zone) to its end:

```
zone      := the travel schedule covering this day, else the schedule zone
dayStart  := local midnight of this day in zone      -- corrected for the offset change between the query
                                                    -- start and this day, so DST days still start at 00:00
if weekday(dayStart) not in rule.days: next day
start, end := dayStart + rule.start, dayStart + rule.end
shift both by (offset at start − offset at the same wall-clock time)   -- the 60-minute DST correction
clamp to [queryFrom, queryTo]; an end of 23:59 becomes 24:00
skip if end < start
merge: a range with the same end that overlaps → widen its start;
       a range ending exactly at this start (keyed by its end instant) → join them (crosses midnight);
       else insert keyed by end instant
```

The map keyed by end instant, plus an end-time index built once, is what lets availability run past midnight as one range.

### 4.3 Overrides, time off and holidays (`buildDateRanges`, `calculateOutOfOfficeRanges`, `calculateHolidayBlockedDates`)

```
weekly    := 4.2 over every weekly rule, grouped by local date
overrides := each override within [from − 1 day, to + 1 day] → one range on its date
             (travel-aware zone; an end of 23:59 → next midnight), grouped by local date
ooo       := every time-off day that is a working weekday → a zero-length range, grouped by date
holidays  := every holiday on a working weekday, unless disabled → treated as time off (OOO wins ties)

dateRanges     := for each date, the override group if present, else the weekly group; drop zero-length
oooExcluded    := same, with time off and holidays replacing the group; drop zero-length
```

Replacement is per local date, not per range: one override on a date discards every weekly range on that date. Two outputs exist because a single person's time off is shown as "away" slots (with the cover person) while a team calculation must exclude it.

### 4.4 Interval algebra (`intersect`, `subtract`, `mergeOverlapping*`, `filterRedundantDateRanges`)

- **Intersect k lists**: sort each list by start; fold left with a two-pointer walk; keep `max(starts) < min(ends)`; advance the pointer whose range ends first; stop early when the running result is empty. Touching ranges do not intersect.
- **Subtract**: sort the excluded ranges once; for each source range sweep a cursor, emitting the gap before each excluded range and moving the cursor to its end; emit the tail.
- **Merge**: sort by start; extend the last range while the next one starts at or before its end.
- **Drop contained ranges**: an interval tree answers "which ranges contain this one"; exact duplicates keep the later index.

These four are the reusable core for 3.5. They are small, pure and have the best tests in the repository.

### 4.5 Busy time (`_getBusyTimes`)

```
window   := [from − maxBuffer, to + maxBuffer]            -- also ± duration when rescheduling
internal := bookings the person hosts or attends in window:
            seated booking with seats left, same event type → only its buffers are busy
            the booking being rescheduled → skipped
            otherwise [start − (its beforeBuffer + new afterBuffer), end + (its afterBuffer + new beforeBuffer)]
external := calendar adapters over [from − 11 h, to + 14 h]       -- padding for zones far from UTC
            minus open-seat ranges and the rescheduled booking's own range
            widened by the new event's buffers
on adapter failure: throw, unless the caller asked to continue silently (then external is empty)
available := subtract(dateRanges, internal ∪ external ∪ limit blocks)
```

When the whole busy fetch throws, `getUserAvailability` returns no ranges at all: that path fails closed. The silent flag is the fail-open exception (section 7).

### 4.6 Period caps (`LimitManager`, `getBusyTimesFromLimits`)

```
for unit in [year, month, week, day]:                 -- coarse first
  for each period start p of unit inside the query (in the person's zone):
    if a coarser period covering p is already blocked: skip
    count limit:    bookings in p ≥ limit                       → block the whole period
    duration limit: requested length > limit, or
                    requested length + booked minutes in p > limit → block the whole period
year totals come from one aggregate query; smaller units scan the fetched bookings
```

"A week is already blocked" means the year is blocked, or both months the week touches are blocked, or the week itself is. Blocks are busy ranges like any other and flow into `subtract`.

### 4.7 Team aggregation (`getAggregatedAvailability`)

```
fixed     := intersect(every fixed host's ranges), merged     -- collective events: everyone is fixed
groups    := round-robin hosts grouped by groupId; each group's ranges are unioned (not merged)
available := intersect([fixed] + one union per group), dedupe, drop contained ranges
```

An empty fixed result is kept as a constraint, so a busy fixed host blocks everything.

### 4.8 Slot generation (`slots.ts`; read for rules, not needed by Islestone)

Step size comes from the first of 60, 30, 20, 15, 10, 5 that divides the slot frequency. The first slot is `max(range start, now + minimum notice)`, seconds zeroed, converted to the viewer's zone, then rounded up to the step. An "optimised" mode instead keeps the raw start unless the leftover minutes allow moving to the hour, the quarter hour or 5 minutes. Slots are unique by start time, and a new range snaps to an earlier slot boundary that still covers it. The function reads the clock and an environment variable itself, so it is not pure.

### 4.9 Booking windows (`calculatePeriodLimits`)

`ROLLING`: end = now in the booker's zone + N days, calendar days or business days (`businessDaysAdd`, weekdays 1–5 by default, with holiday and extra-working-day lists). `ROLLING_WINDOW`: walk forward until N bookable days are found. `RANGE`: start and end dates taken at midnight in the event's zone, with a detector for an older storage format.

### 4.10 Holds and commit (`reserveSlot.handler.ts`, `ensureAvailableUsers.ts`, `IdempotencyKeyService`)

A viewer's chosen slot is held as a `SelectedSlots` row keyed by a cookie id for `MINUTES_TO_BOOK` minutes (default 5, set by a public environment variable); other viewers see it as busy. At commit, availability is recomputed in `"booking"` mode, which bypasses the cache (`RegularBookingService.ts` line 733). The booking's `idempotencyKey` is a UUIDv5 of (start, end, host[, reassigner]) under a unique index. A Prisma query extension (`packages/prisma/extensions/booking-idempotency-key.ts`, 54 lines) sets it on every create with status ACCEPTED and clears it on any update to CANCELLED or REJECTED. That stops two accepted bookings of the same host at the same exact slot. Nothing in the database stops overlapping bookings that start at different times: no exclusion constraint exists in the migrations (grep for `EXCLUDE USING`, `tstzrange`, `btree_gist` found none).

### 4.11 Adapter port and fan-out (`Calendar`, `getCalendarsEvents`, `getBusyCalendarTimes`)

The port has `createEvent`, `updateEvent`, `deleteEvent`, `getAvailability`, optional `getAvailabilityWithTimeZones` and `getAvailabilityWithTitles` ("only ever shown to the owner"), and `listCalendars`. A fetch carries a `mode`: `slots` may use the cache; `booking` (commit) and `overlay` (the owner's own view, with titles) never do. The fan-out decrypts each credential (an envelope with the credential type as associated data, falling back to a legacy key), drops invalid credentials, deduplicates delegated and personal credentials for the same calendars, passes each adapter only its own selected calendars, and skips a non-delegated credential with none selected.

Provider specifics:

- **Google**: free/busy query in chunks of at most 90 days (the API's range limit), one minute between chunks. Events are created with `iCalUID` set to the booking's, `visibility: private` when details are hidden, and an RRULE string from `rrule` for recurring bookings.
- **Microsoft**: one `calendarView` request per calendar inside a Graph `$batch`, `$top=999`, `$select=showAs,start,end[,subject]`; follows `@odata.nextLink`; retries 429 sub-responses up to twice after the largest `Retry-After` plus jitter; `free` and `workingElsewhere` are not busy; times get a `Z` appended (UTC assumed). Windows zone names are mapped to IANA with `windows-iana`.
- **CalDAV and Apple**: `tsdav` fetches objects; `ical.js` parses them after sanitising; transparent events are skipped; a missing `VTIMEZONE` is synthesised from the TZID; recurrences are expanded client-side up to 365 iterations, and hourly or finer rules are skipped.

### 4.12 Subscription lifecycle (`CalendarSubscriptionService`, adapters, renewal query)

```
subscribe(selectedCalendar):
  needs a credential; refuse after 3 consecutive subscribe errors
  adapter.subscribe → store channel id, resource id, expiry; reset error counters
  on error: clear syncSubscribedAt, stamp error time, count up (capped at 3), rethrow
  then processEvents once (initial fill)

renewal job (cron, 100 per run; only while the cache flag is on globally):
  calendars whose channel is missing or already expired, not errored in the last 24 h, under 3 errors,
  of supported providers, owned by members of teams with the cache flag,
  excluding generic calendars (Google holiday, group, import, resource suffixes)

webhook(provider, request):
  adapter.validate(request) → adapter.extractChannelId(request) → find calendar by channel id
  unknown channel → 200 and ignore; else processEvents

processEvents(calendar):
  both feature flags off → nothing
  events := adapter.fetchEvents(calendar)     -- incremental with the stored cursor; first time: today .. +3 months
  on fetch error: stamp syncErrorAt, increment syncErrorCount, rethrow
  store the new cursor and syncedAt, reset errors
  cache on → upsert busy, non-cancelled events; delete the rest (by calendar + external id)
  sync on  → CalendarSyncService.handleEvents

unsubscribe: stop the channel, clear syncSubscribedAt, delete the calendar's cache rows
```

Google uses `events.watch` with a random channel id, a shared token and a 30-day TTL, then `events.list` with `singleEvents: true`, paging until `nextSyncToken`. Microsoft creates a Graph subscription on the calendar's events (`created,updated,deleted`, 3-day TTL, `clientState` = shared token) and reads a delta link. `getProviders()` returns only `google_calendar`, so Microsoft subscriptions are never created by the renewal job at this commit.

### 4.13 Inbound changes to own events (`CalendarSyncService`)

```
own := events whose iCalUID domain is "cal.com", "cal.diy" or the app name
for each own event:
  bookingUid := iCalUID before "@"; booking must exist and its host must own this calendar
  cancelled → cancel the booking with "Cancelled on user's calendar", flagged to skip deleting the remote event
  otherwise → if the start time did not change: ignore (echo of our own write)
              else rebook at the new start, keeping the original duration, flagged to skip creating a
              remote event, skipping the availability and limit checks, and taking the remote summary,
              description and location as the new title, notes and location
errors are logged per event and never stop the batch
```

The two skip flags are the loop breaker: an inbound change never causes an outbound write of the same change.

### 4.14 Cache reads (`CalendarCacheWrapper`)

Calendars with both a cursor and `syncSubscribedAt` are answered from `CalendarCacheEvent` (start, end, zone); the rest go to the live adapter; results are concatenated. Only `slots` mode uses the wrapper.

### 4.15 OAuth (`OAuthManager`, state helpers)

A token is refreshed 5 seconds before expiry. An `expires_in` below the year-2001 epoch value is treated as relative and unusable, so the token counts as expired. A refresh answered `invalid_grant` marks the credential `invalid`, and the fan-out drops invalid credentials from then on. An access token reported unusable is expired so the next call refreshes. The OAuth `state` carries a random nonce and `HMAC-SHA256(NEXTAUTH_SECRET, nonce:userId)`, compared in constant time on return; five apps are exempt.

## 5. Mapping onto Islestone

### 5.1 By sub-phase

| Sub-phase | What to take from Cal.diy (as patterns, re-implemented) | What Islestone adds |
|---|---|---|
| **3.1** Timeline and critical path ("working calendars and holidays") | Working weekdays, date exceptions, holidays and business-day addition (4.3, 4.9) as a pure working-day predicate and `addWorkingDays` | Islestone's dates are `@db.Date` (ADR 0002 `startDate`, `dueDate`), so the scheduler needs working DAYS, not minutes. Property tests across zones and DST (H3) can reuse the date-ranges and isOutOfBounds cases |
| **3.3** Calendar | The adapter port with fetch modes (4.11); the subscription port and lifecycle (4.12); cursor-based incremental sync; renewal batch with error caps; own-event recognition and loop breaking (4.13); OAuth refresh and invalidation (4.15); Google's 90-day chunking; Graph `$batch` with `Retry-After` | Push side comes from inflect-compliance's connection, mapping and reconcile usecases (roadmap 3.3; BUSL-1.1, copyable under ADR 0001 D1). Inbound matches by the stored remote event id, applies dates only, and runs through the usecase with a version check (5.4). Due dates are pushed as all-day events |
| **3.4** Time tracking | Period-start enumeration (`getPeriodStartDatesBetween`) for weekly timesheets | Week start per workspace |
| **3.5** Workload and capacity | Schedules, weekly rules, overrides, time off, travel and holidays (4.1–4.3); interval algebra (4.4); per-period duration caps as the over-allocation test (4.6); team intersection (4.7) | Capacity = available minutes per member per week from 4.3 minus time off; allocation = estimates or planned hours; over-allocation = 4.6's duration rule, reported, never enforced ("read-only suggestions", roadmap 3.5) |
| **2.5** Recurrence | Not this repository: Cal.diy only writes RRULE strings for recurring bookings. Use the Kaneo study | — |
| **5.2** Webhooks | The validate → identify → look up → process shape, and the lessons in section 7 (constant-time, per-subscription secrets) | Islestone's own delivery-id store |
| Booking pages, event types, seats, round robin, routing, payments | Nothing. Islestone is not a scheduling product, and nothing in the roadmap asks for public booking | — |

### 5.2 Against the ADRs and principles

- **ADR 0002 section 9 (versions).** `dueDate` is a single-field change, so `If-Match` is optional for people. An inbound calendar edit should still send it: the version recorded when the event was last pushed. A 409 means the item changed in Islestone since; record a conflict on the mapping and do not overwrite.
- **ADR 0002 section 11 (encryption).** `title` is plaintext and may be pushed; `description` is encrypted and is never pushed. That matches roadmap 3.3, "Event titles pushed outside carry item titles only". Cal.diy pushes a description and location and, inbound, takes the remote summary and description into the booking. Islestone does neither.
- **ADR 0003 (agents through proposals).** An inbound edit is neither a person in the UI nor an agent. Recommended: apply it as the connection owner, through the ordinary usecase, re-checking at apply time that the owner still holds edit permission on the item, audited with `source: calendar_sync` and the subscription id. Whether it should instead arrive as a change the person confirms (as roadmap 3.1 does for a dragged bar) is open question 2.
- **ADR 0005 sections 2–3.** Records are server-authoritative and every write runs a usecase; Cal.diy's "ignore when the start time did not change" is the same rule as "echoes are ignored". An inbound write emits the usual change notice.
- **ADR 0006.** "Calendar" is a layout. Add "Calendar connection" (one person's link to one provider) and "Calendar subscription" (one watched calendar) to the vocabulary before 3.3, with "Integration" and "Credential" as rejected synonyms for the connection.
- **Principle 4 (deterministic numbers).** The availability and capacity core must take `now`, the zone database and configuration as inputs. Cal.diy's `getSlots` reads the clock and an environment variable; the Islestone module must not.
- **Principle 5 (RLS).** Every table in section 3's sketch is tenant-scoped. Cal.diy's `HolidayCache` is global; Islestone either ships holiday data as a versioned module or keeps a global reference table with a documented RLS exception (open question 3).

### 5.3 Hardening H3 items this informs

- **Revoked tokens**: 4.15's `invalid_grant` → mark the connection revoked, stop its subscriptions, notify the owner; test with a refresh that answers `invalid_grant`, and with a 401 on a data call.
- **Duplicates**: the mapping's unique key plus an idempotency key on each push; a test that delivers the same webhook twice and the same delta page twice and asserts one write.
- **Deleted events**: Google `status: cancelled` items in an incremental list; Graph `@removed` items in a delta (not handled by Cal.diy, section 7); a delete on an already-deleted remote event (Cal.diy treats Google's 410 on delete as success, `googlecalendar/lib/CalendarService.ts` line 487).
- **Time zones and DST**: translate the date-ranges, slots and isOutOfBounds cases listed in section 2.

### 5.4 Inbound match, done safely

```
on webhook: verify the per-subscription secret in constant time → subscription by channel id
fetch the delta with the stored cursor; on "cursor no longer valid" → state NEEDS_FULL_SYNC, full re-read
for each changed remote event:
  mapping := CalendarEventMapping by (subscription's connection, remote event id)   -- never by iCalUID alone
  no mapping → ignore (not ours)
  remote etag = mapping.lastSeenRemoteEtag → ignore (echo)
  cancelled/removed → clear the due date? or unlink? (owner decision; default: unlink the mapping, keep the date)
  moved → newDue := the all-day start date; if newDue = item.dueDate → ignore
          call updateDueDate(ctx of the connection owner, item, newDue, ifMatch = mapping.lastPushedVersion)
          409 → mark the mapping CONFLICT and notify; 403 → mark it FORBIDDEN, stop applying
  store the new etag
```

## 6. What Islestone must not take

**Licence and provenance**

- `packages/types/ical.d.ts`: GPL-3.0-only. Do not read past its header, copy it or derive from it. If Islestone needs `ical.js` types, write them or use the package's own.
- Anything from git history before `ab21c7f8` (AGPLv3 and the Cal.com Commercial License), and anything from `calcom/cal.com`.
- `apps/api/v2/**` (`UNLICENSED` field). Not needed.
- The Stack Overflow-derived `Class<I, Args>` helper in `packages/types/Calendar.d.ts` lines 328–332 (CC BY-SA).
- `.yarn/releases/*` and `.yarn/patches/*` (upstream licences, unverified).
- The names "Cal.com" and "Cal.diy", their logos and their iCalUID domains. MIT grants no trademark rights. Islestone's iCalUIDs use its own domain.
- `ical.js` (MPL-2.0) only as an unmodified dependency, as the gate already says.

**Scope**

- The booking product: event types, booking pages, seats, round robin, routing forms, payments, workflows, embeds, the app store. Roadmap 3.3 asks for a calendar view and due-date sync, not booking.
- Holiday data through Google's public holiday calendars with a deployment API key, unless the owner chooses it (it adds a Google dependency to every availability read that has a country set).

**Design defects seen while reading (as read; nothing was run)** — section 7.

## 7. Defects and weak points (do not carry over)

| # | Where | What was read | Islestone rule |
|---|---|---|---|
| 1 | `apps/web/app/api/cron/calendar-subscriptions/route.ts` and `-cleanup/route.ts` | The secret check compares the header (or an `apiKey` query parameter) with a list containing `` `Bearer ${process.env.CRON_SECRET}` ``. With `CRON_SECRET` unset that string is `"Bearer undefined"`, which a caller can send. Plain `includes`, not constant-time; the key is accepted in a URL | Jobs run on BullMQ, not public cron URLs. Any shared-secret check refuses when the secret is unset, compares in constant time, and never reads a secret from a query string |
| 2 | `GoogleCalendarSubscription.adapter.ts` 32–43 | One deployment-wide token for every channel, compared with `!==` | A secret per subscription, stored hashed, compared in constant time |
| 3 | `Office365CalendarSubscription.adapter.ts` 77–118 with the webhook route | `validate()` returns true for any request carrying a `validationToken` query parameter; the route never echoes that token back. `clientState` and `subscriptionId` are read from `request.body` as if it were parsed. Graph sends notifications as a JSON body with a `value[]` array and expects the validation token echoed as `text/plain` (Microsoft's documented contract; not re-read here). `getProviders()` excludes Microsoft anyway | Write the Microsoft handshake and notification parsing fresh against Microsoft's documentation, with tests from captured payloads |
| 4 | `Office365CalendarSubscription.adapter.ts` 193–221 | Delta items are mapped without handling `@removed` entries; `start.dateTime` (zone-less) is parsed with `new Date`, so it is read in the server's zone; the delta path is `/me/calendars/{id}/events/delta` (whether v1.0 serves it is unverified) | Treat `@removed` as a delete; parse with the item's own `timeZone`, or request UTC with Graph's `Prefer: outlook.timezone` header |
| 5 | `GoogleCalendarSubscription.adapter.ts` 104–152 | No handling of an expired sync token. Google answers 410 Gone and expects a full re-sync (Google's documented behaviour; not re-read here). Here the error only counts up and the stale token is kept | On "cursor invalid", clear it and run a bounded full sync |
| 6 | Same file 172–184 | An all-day event's `date` becomes UTC midnight, not midnight in the calendar's zone | Keep all-day items as dates end to end; due dates are dates |
| 7 | `SelectedCalendarRepository.findNextSubscriptionBatch` with `CalendarCacheWrapper` | Channels are renewed only after they expire; the cache trusts any calendar with a cursor and `syncSubscribedAt`, whatever the expiry, the error count or whether the query reaches beyond the 3-month fill window. Expired or out-of-window reads come back "free" | Renew at a fraction of the TTL; read cache only when the subscription is ACTIVE, unexpired, recently synced and the range is inside the filled window; otherwise go live |
| 8 | `CalendarSyncService.ts` 87–244 | Inbound changes are trusted by iCalUID alone. Anyone able to place an event with a chosen UID (for example an invitation) in the host's calendar, and who knows a booking uid, could cancel or move that booking; the move skips availability and limits and copies remote text into the booking. Plausible from the code; not tested | Match by the stored remote event id (5.4); take dates only; never import remote text |
| 9 | `CalendarCacheEventService.ts` 33–57 | The cache stores other people's event summaries, descriptions and locations | Store free/busy only (start, end, all-day, show-as) |
| 10 | `getBusyTimes.ts` 194–220 and `CalendarManager.ts` 346–352 | `silentlyHandleCalendarFailures` turns a failed calendar read into "no busy time" | A failed read is a visible degraded state, never "free" |
| 11 | `office365calendar/lib/CalendarService.ts` 584–624, 706–723 | Batch sub-responses with an error status pass through as successes with no `value`, so that calendar reads as free; requests are not split into Graph's batch limit (20 requests per batch, from Microsoft's documentation, not re-read) | Treat any non-2xx sub-response as a failed read; chunk batches |
| 12 | `packages/lib/CalendarService.ts` 739–797 | Recurring CalDAV events: hourly and finer rules are skipped; expansion stops at 365 iterations; an occurrence that starts before the window but overlaps it is dropped (`isBetween` on the start) | Expansion failures are reported, not dropped; overlap, not start, decides inclusion |
| 13 | `ics-feedcalendar/lib/CalendarService.ts` 86 and `api/add.ts` | User-supplied feed URLs are fetched with plain `fetch`: no SSRF check, no size cap, no timeout. A guard exists (`packages/lib/ssrfProtection.ts`, 236 lines) but is not used here, and it allows private addresses on self-hosted installs | Every outbound fetch goes through Islestone's safe-fetch layer |
| 14 | `getBusyTimes.ts` 185–191, 223–233; `getUserAvailability.ts` 662 | Debug logs carry calendar busy times and full availability results | Never log third-party calendar content or per-person availability |
| 15 | `slots.ts` 113, 123 | Reads `process.env` and the clock inside the core function | Inject both (principle 4) |
| 16 | `decodeOAuthState.ts` | The state is bound to the user but has no expiry and is not single-use | Bind it to a short-lived, single-use, HttpOnly cookie, as inflect-compliance's SSO flow does (pattern only) |
| 17 | `upsertMany` in `CalendarCacheEventRepository.ts` 30–55 | `Promise.allSettled` swallows failed upserts | A failed write fails the batch and keeps the cursor, so the next run retries |

## 8. Attribution Islestone would carry

MIT requires the copyright and permission notice in "all copies or substantial portions". A re-implementation that follows only the design is pattern only. Any module that follows a Cal.diy function closely, and any test whose cases are translated from Cal.diy's tests, carries the notice to stay safe.

**`PROVENANCE.md` rows (one per adopted piece), for example:**

| Component | Source | Commit | Licence | Changes |
|---|---|---|---|---|
| Working-hours expansion with overrides, time off, travel and DST (3.5) | `calcom/cal.diy` `packages/features/schedules/lib/date-ranges.ts` (`processWorkingHours`, `processDateOverride`, `buildDateRanges`) | `ae027bb70e694e2d2c44569f398d6cbcee0389b1` | MIT, © 2020-present Cal.com, Inc. | Re-implemented over integer minutes and IANA zones as a pure module with `now` injected; no file copied |
| Interval algebra (3.5) | same repo, `date-ranges.ts` (`intersect`, `subtract`, `mergeOverlappingRanges`), `.../date-range-utils/*`, `packages/lib/intervalTree.ts` | same | MIT | Re-implemented over plain numbers |
| Per-period capacity caps (3.5) | `packages/lib/intervalLimits/limitManager.ts`, `packages/features/busyTimes/lib/getBusyTimesFromLimits.ts` | same | MIT | Duration rule reused as an over-allocation report; nothing is blocked |
| Working-day arithmetic (3.1) | `packages/dayjs/plugins/business-days-plugin.ts`, `packages/lib/isOutOfBounds.tsx` (`calculatePeriodLimits`) | same | MIT (plugin origin unverified, section 1) | Re-implemented on the scheduler's calendar type |
| Calendar subscription lifecycle and inbound sync (3.3) | `packages/features/calendar-subscription/**`, `packages/features/selectedCalendar/repositories/SelectedCalendarRepository.ts` (`findNextSubscriptionBatch`) | same | MIT | Per-subscription secrets; match by mapping, not iCalUID; dates only; usecase with `If-Match`; renewal before expiry; section 7 fixes |
| Provider adapter port and fetch modes (3.3) | `packages/types/Calendar.d.ts` (`Calendar`, `CalendarFetchMode`; not lines 328–332), `packages/features/calendars/lib/CalendarManager.ts`, `getCalendarsEvents.ts` | same | MIT | Free/busy only; failures surface |
| OAuth token lifecycle (3.3) | `packages/app-store/_utils/oauth/OAuthManager.ts`, `invalidateCredential.ts` | same | MIT | Revocation stops subscriptions and notifies the owner |
| Test cases (H3) | `date-ranges.test.ts`, `slots.test.ts`, `isOutOfBounds.timezone.test.ts`, `CalendarSyncService.test.ts` and the others in section 2 | same | MIT | Inputs and expected results translated into Islestone's tests |

**`NOTICE` entry:**

```
This product includes software adapted from Cal.diy (https://github.com/calcom/cal.diy),
commit ae027bb70e694e2d2c44569f398d6cbcee0389b1, licensed under the MIT License:

  MIT License

  Copyright (c) 2020-present Cal.com, Inc.

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

Each adapted source file also gets a one-line header: `// Adapted from Cal.diy (MIT, © 2020-present Cal.com, Inc.), <path> @ ae027bb7. See NOTICE.`

The existing `PROVENANCE.md` row for Cal.diy ("UNPINNED") moves to Adopted with this commit only when the first piece lands, after the H0 re-read of `LICENSE` at that commit.

## 9. Open questions for the owner

1. **Relicensing.** Cal.diy's MIT grant covers code written by outside contributors under AGPLv3 before 2026-04-15, and the repository shows no contributor licence agreement. Is "pattern only, re-implemented" enough for Islestone, or should code-close adaptations be limited to files written after `ab21c7f8`, or cleared with Cal.com, Inc. in writing?
2. **Inbound edits.** When someone moves a due-date event in their own calendar, does Islestone apply it as that person (with a version check and audit), or show it as a change they confirm?
3. **Holiday data.** Google's public holiday calendars (an API key and a Google dependency), a static dataset shipped and versioned in code, or a global reference table with a documented RLS exception?
4. **Providers at launch.** Google and Microsoft, as roadmap 3.3 says, with CalDAV and ICS feeds later? Microsoft's inbound path needs fresh work (section 7, rows 3, 4 and 11).
5. **Cancelled remote events.** Clear the item's due date, or only unlink the mapping and keep the date?
6. **Push channels need a public HTTPS endpoint** per environment. Is a polling fallback (incremental list every N minutes) acceptable where push is unavailable, such as preview environments?

## Licence check

**CORRECTED** (minor; the licence verdict stands). Independent re-check, 2026-11-18, without relying on the earlier study. Only files were read; nothing in the clone was run.

Confirmed:

- The clone is `https://github.com/calcom/cal.diy` at `ae027bb70e694e2d2c44569f398d6cbcee0389b1` (2026-11-13), not shallow, clean working tree. `git ls-remote` shows that commit is upstream `HEAD` and `refs/heads/main` today.
- Root `LICENSE` is MIT, "Copyright (c) 2020-present Cal.com, Inc.", 21 lines, SHA-256 `95f3d2c4…ac321c`. The copy fetched from `raw.githubusercontent.com/calcom/cal.diy/ae027bb7…/LICENSE` (HTTP 200) has the same hash.
- Exactly six nested `LICENSE` files, at the six paths listed in section 1. All six are byte-identical (SHA-256 `67bf1d96…e79aa2`): the root text plus one trailing blank line, hence 22 lines. The `packages/embeds/embed-core/LICENSE` fetched from GitHub raw has the same hash.
- `package.json` licence fields over all 119 manifests: MIT ×6, `SEE LICENSE IN LICENSE` ×3 (the embeds), ISC ×1 (`apps/api`, private), `UNLICENSED` ×1 (`apps/api/v2`, private). The other 108 have none.
- One SPDX header in the tree: `packages/types/ical.d.ts`, GPL-3.0-only, © 2019 EteSync Authors, 269 lines. No other GPL, AGPL, LGPL, MPL, BUSL, SSPL, Elastic or "Commercial License" text in tracked source. The only hits are two unused i18n strings (`acquire_license`, `acquire_commercial_license`).
- No `ee/` path, no NOTICE file, no contributor licence agreement (none in `CONTRIBUTING.md`, `README.md` or `.github/` at HEAD, nor in `CONTRIBUTING.md` or `.github/` at `ab21c7f805^`).
- `LICENSE` last changed in `ab21c7f805a089fa3a11ffd61c4a9aecc349c16c` (2026-04-15, "refactor: Cal.diy (#28903)"). At `ab21c7f805^` it was AGPLv3, with `packages/features/ee` and `apps/api/v2/src/ee` under the Commercial License.
- README lines 43 and 660 make the "100% MIT" and "no commercial/enterprise code" claims as quoted.
- Calendar dependency licences re-queried on the npm registry at the pinned versions: all eight match the table. Each is on Islestone's `ALLOWED_LICENCES`, and MPL-2.0 carries the unmodified-use notice, as stated.

Corrected or added in section 1:

1. **`enterprise` paths.** There are three, not one. The two extra are images.
2. **Stack Overflow helper.** It is one line (330), not "2 lines at 330–332". Line 332 is Cal.diy's own use of it. The do-not-copy advice is unchanged.
3. **New fact: former Commercial-licensed `ee` code was moved into MIT paths at relicensing.** At least 95 files, 91 of them in `apps/api/v2`. None of the 63 paths section 2 recommends is among them. Each of those was at the same non-`ee` path before relicensing, so before it its licence was AGPLv3. This adds weight to the advice to stay out of `apps/api/v2`. It also affects owner question 1: a "files added after `ab21c7f8`" test would admit the moved code.

Still not verified, and not a legal opinion: whether Cal.com, Inc. could relicense outside contributors' AGPLv3 code (or its Commercial-licensed `ee` code) as MIT without a contributor licence agreement.
