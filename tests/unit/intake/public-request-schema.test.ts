/**
 * A public form's request schema (sub-phase 2.6b): the members' request plus
 * the requester's name and address as the form's rules ask, and the opt-in to
 * email updates. The same schema validates the public page and the submit.
 */
import {
    compileIntakeRequestSchema,
    compilePublicIntakeRequestSchema,
    IntakeFormDefinitionSchema,
    type IntakeFormDefinition,
    type IntakeRequesterRules,
} from '@/lib/intake/form-definition';

const def = (requester: IntakeRequesterRules): IntakeFormDefinition => ({
    intro: '',
    confirmation: 'Thanks',
    fields: [{ id: 'f1', kind: 'SHORT_TEXT', label: 'Where', required: false }],
    requester,
});

describe('the public request schema', () => {
    it('asks for nothing more when the rules are off, and refuses a requester field sent anyway', () => {
        const s = compilePublicIntakeRequestSchema(def({ name: 'OFF', email: 'OFF' }));
        expect(s.safeParse({ title: 'Broken' }).success).toBe(true);
        expect(s.safeParse({ title: 'Broken', requesterEmail: 'a@b.co' }).success).toBe(false);
        expect(s.safeParse({ title: 'Broken', wantsUpdates: true }).success).toBe(false);
    });

    it('requires a required name and address, and refuses an address that is not one', () => {
        const s = compilePublicIntakeRequestSchema(def({ name: 'REQUIRED', email: 'REQUIRED' }));
        expect(s.safeParse({ title: 'Broken', requesterName: 'Ada', requesterEmail: 'ada@example.com' }).success).toBe(true);
        expect(s.safeParse({ title: 'Broken', requesterName: '  ', requesterEmail: 'ada@example.com' }).success).toBe(false);
        expect(s.safeParse({ title: 'Broken', requesterName: 'Ada' }).success).toBe(false);
        expect(s.safeParse({ title: 'Broken', requesterName: 'Ada', requesterEmail: 'not an address' }).success).toBe(false);
    });

    it('treats a blank optional field as absent, and refuses updates without an address', () => {
        const s = compilePublicIntakeRequestSchema(def({ name: 'OPTIONAL', email: 'OPTIONAL' }));
        const blank = s.safeParse({ title: 'Broken', requesterName: '', requesterEmail: '' });
        expect(blank.success && blank.data).toMatchObject({ requesterName: undefined, requesterEmail: undefined, wantsUpdates: false });
        expect(s.safeParse({ title: 'Broken', requesterEmail: '', wantsUpdates: true }).success).toBe(false);
        expect(s.safeParse({ title: 'Broken', requesterEmail: 'ada@example.com', wantsUpdates: true }).success).toBe(true);
    });

    it('caps the name and the address', () => {
        const s = compilePublicIntakeRequestSchema(def({ name: 'OPTIONAL', email: 'OPTIONAL' }));
        expect(s.safeParse({ title: 'Broken', requesterName: 'x'.repeat(101) }).success).toBe(false);
        expect(s.safeParse({ title: 'Broken', requesterEmail: `${'a'.repeat(250)}@b.co` }).success).toBe(false);
    });

    it('the members\' schema never takes requester fields', () => {
        expect(compileIntakeRequestSchema(def({ name: 'REQUIRED', email: 'REQUIRED' })).safeParse({ title: 'Broken', requesterName: 'Ada' }).success).toBe(false);
    });

    it('the definition refuses an unknown rule', () => {
        expect(IntakeFormDefinitionSchema.safeParse({ ...def({ name: 'OFF', email: 'OFF' }), requester: { name: 'ALWAYS', email: 'OFF' } }).success).toBe(false);
    });
});
