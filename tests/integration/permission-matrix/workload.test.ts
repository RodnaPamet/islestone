/**
 * The H2 permission matrix: the capacity and time-off routes of sub-phase 3.5a
 * (owner decisions 175, 176, 287, 288 and 298). The expected table is
 * `table.ts`; the driver is `harness.ts`. Only NextAuth's cookie decode and
 * the job queue are replaced.
 */
import { DB_AVAILABLE } from '../db-helper';

const mockAuth = jest.fn();
jest.mock('@/auth', () => ({ auth: () => mockAuth() }));
jest.mock('@/app-layer/jobs/queue', () => ({
    enqueue: async () => ({ id: 'matrix-job' }),
    getQueue: () => ({ getJob: async () => null }),
}));

import { describeMatrix } from './harness';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

describeFn('the permission matrix: workload', () => {
    describeMatrix('workload', `pmwl${Date.now().toString(36)}`, mockAuth);
});
