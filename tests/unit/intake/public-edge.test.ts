/**
 * The public intake surface at the edge (sub-phase 2.6b): the read-tier key
 * the middleware meters each public path under, and the deployment switch.
 */
import { publicIntakeRateKey } from '@/lib/auth/guard';
import { isPublicIntakeOpen } from '@/lib/intake/public-switch';

const ID = 'AbCdEfGhIjKlMnOpQrStUv';

describe('the edge key of a public intake path', () => {
    it('keys a form and its submit by the form, the confirmation by nothing but the IP', () => {
        expect(publicIntakeRateKey(`/f/${ID}`)).toBe(`intakeform:${ID}`);
        expect(publicIntakeRateKey(`/api/intake/forms/${ID}`)).toBe(`intakeform:${ID}`);
        expect(publicIntakeRateKey('/f/confirm/sometoken')).toBe('intakeconfirm');
        expect(publicIntakeRateKey('/api/intake/confirm')).toBe('intakeconfirm');
    });

    it('pools every id that is not a public id, so guessing mints no fresh budget', () => {
        for (const p of ['/f/short', '/f/x/y', '/api/intake/forms/<script>', '/api/intake/forms', '/f/']) {
            expect({ p, key: publicIntakeRateKey(p) }).toEqual({ p, key: 'intakeform:invalid' });
        }
    });

    it('leaves every other path alone', () => {
        for (const p of ['/forms', '/forms/abc', '/api/t/acme/intake/forms', '/t/acme/intake', '/fx/abc', '/']) {
            expect({ p, key: publicIntakeRateKey(p) }).toEqual({ p, key: null });
        }
    });
});

describe('the public intake switch', () => {
    const saved = { flag: process.env.INTAKE_PUBLIC_FORMS, node: process.env.NODE_ENV };
    afterEach(() => {
        if (saved.flag === undefined) delete process.env.INTAKE_PUBLIC_FORMS;
        else process.env.INTAKE_PUBLIC_FORMS = saved.flag;
        (process.env as Record<string, string | undefined>).NODE_ENV = saved.node;
    });

    it('is closed in production unless opened, and open elsewhere unless closed', () => {
        delete process.env.INTAKE_PUBLIC_FORMS;
        (process.env as Record<string, string>).NODE_ENV = 'production';
        expect(isPublicIntakeOpen()).toBe(false);
        process.env.INTAKE_PUBLIC_FORMS = '1';
        expect(isPublicIntakeOpen()).toBe(true);
        (process.env as Record<string, string>).NODE_ENV = 'development';
        process.env.INTAKE_PUBLIC_FORMS = '0';
        expect(isPublicIntakeOpen()).toBe(false);
        delete process.env.INTAKE_PUBLIC_FORMS;
        expect(isPublicIntakeOpen()).toBe(true);
    });
});
