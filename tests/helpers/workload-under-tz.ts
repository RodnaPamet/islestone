/**
 * Run the workload modules on the large fixture and print every row's figures
 * as JSON (tests/unit/domain/workload-timezones.test.ts runs it under several
 * `TZ` values, each in its own process, so the zone is set before any module
 * loads).
 */
import { buildWorkload } from '../../src/app-layer/domain/workload/workload';

import { largeWorkload } from './workload-fixture';

const out = buildWorkload(largeWorkload(2_000));
const rows = [...out.rows.entries()].map(([id, r]) => [id, r.capacity.map((c) => c.capacityMinutes), r.allocated, r.over, r.share, r.later, r.noDates]);
process.stdout.write(JSON.stringify({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone, result: { rows, unassigned: out.unassigned.allocated } }));
