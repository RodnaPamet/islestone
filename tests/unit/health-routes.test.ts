import * as livez from '@/app/api/livez/route';
import * as readyz from '@/app/api/readyz/route';

describe.each([
    ['/api/livez', livez],
    ['/api/readyz', readyz],
])('%s', (_path, route) => {
    it('answers 200 with {"status":"ok"} as JSON', async () => {
        const res = route.GET();

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/^application\/json/);
        await expect(res.json()).resolves.toEqual({ status: 'ok' });
    });

    it('is never cached, so a probe sees the live process', () => {
        expect(route.GET().headers.get('cache-control')).toBe('no-store');
        // Without this, Next.js could serve a build-time answer.
        expect(route.dynamic).toBe('force-dynamic');
    });
});
