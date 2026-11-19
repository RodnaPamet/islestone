import { skipEnvValidation } from '@/env-skip';

describe('SKIP_ENV_VALIDATION', () => {
    const original = process.env.SKIP_ENV_VALIDATION;
    afterEach(() => {
        if (original === undefined) delete process.env.SKIP_ENV_VALIDATION;
        else process.env.SKIP_ENV_VALIDATION = original;
    });

    it.each(['1', 'true', 'TRUE', ' 1 '])('%j skips validation', (value) => {
        process.env.SKIP_ENV_VALIDATION = value;
        expect(skipEnvValidation()).toBe(true);
    });

    // `!!process.env.SKIP_ENV_VALIDATION` would read "0" and "false" as true.
    it.each(['0', 'false', '', 'no', 'yes'])('%j leaves validation on', (value) => {
        process.env.SKIP_ENV_VALIDATION = value;
        expect(skipEnvValidation()).toBe(false);
    });

    it('unset leaves validation on', () => {
        delete process.env.SKIP_ENV_VALIDATION;
        expect(skipEnvValidation()).toBe(false);
    });
});
