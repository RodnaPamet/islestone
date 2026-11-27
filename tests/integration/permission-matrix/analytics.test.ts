/**
 * The H2 permission matrix: the analytics reads of sub-phase 3.6a
 * (owner decisions 175, 176 and 329). The expected table is
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

describeFn('the permission matrix: analytics', () => {
    describeMatrix('analytics', `pman${Date.now().toString(36)}`, mockAuth);
});
