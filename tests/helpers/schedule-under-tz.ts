/**
 * Run the scheduling engine on the JSON input read from stdin and print the
 * result as JSON (tests/unit/domain/schedule-timezones.test.ts runs it under
 * several `TZ` values, each in its own process, so the zone is set before any
 * module loads).
 */
import { readFileSync } from 'node:fs';

import { computeSchedule } from '../../src/app-layer/domain/schedule/engine';
import type { ScheduleInput } from '../../src/app-layer/domain/schedule/types';

const input = JSON.parse(readFileSync(0, 'utf8')) as ScheduleInput;
process.stdout.write(JSON.stringify({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone, result: computeSchedule(input) }));
