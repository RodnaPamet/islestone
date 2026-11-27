/**
 * The H2 permission matrix: the analytics reads of sub-phases 3.6a and 3.6b
 * (owner decisions 175, 176 and 329; time waiting's rows for other people). The expected table is
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
