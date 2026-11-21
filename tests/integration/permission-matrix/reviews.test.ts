/**
 * The H2 permission matrix: the reviews routes (owner decisions 175 and
 * 176). The expected table is `table.ts`; the driver is `harness.ts`.
 * Only NextAuth's cookie decode and the job queue are replaced.
 */
import { DB_AVAILABLE } from '../db-helper';

const mockAuth = jest.fn();
jest.mock('@/auth', () => ({ auth: () => mockAuth() }));
const mockJobs = new Map<string, { id: string; name: string; data: unknown }>();
jest.mock('@/app-layer/jobs/queue', () => ({
    enqueue: async (name: string, data: unknown) => {
        const id = `matrix-job-${mockJobs.size + 1}`;
        mockJobs.set(id, { id, name, data });
        return { id };
    },
    getQueue: () => ({
        getJob: async (id: string) => {
            const job = mockJobs.get(id);
            return job ? { ...job, progress: 0, returnvalue: null, failedReason: null, getState: async () => 'waiting' } : null;
        },
    }),
}));

import { describeMatrix } from './harness';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

describeFn('the permission matrix: reviews', () => {
    describeMatrix('reviews', `pmrv${Date.now().toString(36)}`, mockAuth);
});
