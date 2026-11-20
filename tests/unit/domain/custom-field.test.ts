/**
 * Custom-field values and filter conditions, parsed per type (sub-phase 2.4,
 * `src/app-layer/domain/custom-field.ts`): every accept and every refusal the
 * write path and the list query rely on.
 */
import { normaliseNumber, parseCustomFieldCondition, parseCustomFieldValue } from '@/app-layer/domain/custom-field';
import { CUSTOM_FIELD_TYPE_SPECS, CUSTOM_FIELD_TYPES, customFieldFilterParam, fieldIdOfFilterKey, fieldIdOfOrder } from '@/lib/work-items/custom-fields';

const refused = (fn: () => unknown) => expect(fn).toThrow(expect.objectContaining({ status: 400 }));

describe('parseCustomFieldValue', () => {
    it('null clears every type', () => {
        for (const t of CUSTOM_FIELD_TYPES) expect(parseCustomFieldValue(t, null)).toEqual({ kind: 'clear' });
    });

    it('text: control whitespace to spaces, trimmed, empty clears, capped at 500', () => {
        expect(parseCustomFieldValue('TEXT', '  a\nb\tc  ')).toEqual({ kind: 'text', value: 'a b c' });
        expect(parseCustomFieldValue('TEXT', '   ')).toEqual({ kind: 'clear' });
        refused(() => parseCustomFieldValue('TEXT', 'x'.repeat(501)));
        refused(() => parseCustomFieldValue('TEXT', 5));
    });

    it('URL: absolute http or https only', () => {
        expect(parseCustomFieldValue('URL', 'https://example.com/a?b=1')).toEqual({ kind: 'text', value: 'https://example.com/a?b=1' });
        for (const bad of ['javascript:alert(1)', 'ftp://x.y', '/relative', 'not a url', `https://e.com/${'x'.repeat(500)}`]) {
            refused(() => parseCustomFieldValue('URL', bad));
        }
    });

    it('number: a number or a plain decimal string; never stripped; range and decimals bounded', () => {
        expect(parseCustomFieldValue('NUMBER', 12.5)).toEqual({ kind: 'number', value: '12.5' });
        expect(parseCustomFieldValue('NUMBER', '-3.000001')).toEqual({ kind: 'number', value: '-3.000001' });
        expect(parseCustomFieldValue('NUMBER', '')).toEqual({ kind: 'clear' });
        for (const bad of ['1,5', '1e3', '12%', '1.0000001', 1e9, '1000000000', Number.NaN, Infinity, true]) {
            refused(() => parseCustomFieldValue('NUMBER', bad));
        }
        expect(normaliseNumber(999_999_999.123456, 'n')).toBe('999999999.123456');
    });

    it('date: a real calendar date only', () => {
        expect(parseCustomFieldValue('DATE', '2032-02-29')).toEqual({ kind: 'date', value: '2032-02-29' });
        for (const bad of ['2031-02-29', '2031-13-01', '2031-1-1', '2031-01-01T00:00:00Z', 20310101]) refused(() => parseCustomFieldValue('DATE', bad));
    });

    it('checkbox: true is stored, false is no row', () => {
        expect(parseCustomFieldValue('CHECKBOX', true)).toEqual({ kind: 'checked' });
        expect(parseCustomFieldValue('CHECKBOX', false)).toEqual({ kind: 'clear' });
        refused(() => parseCustomFieldValue('CHECKBOX', 'true'));
    });

    it('select takes one id; multi-select a de-duplicated list; person one id', () => {
        expect(parseCustomFieldValue('SELECT', 'opt_1')).toEqual({ kind: 'options', optionIds: ['opt_1'] });
        refused(() => parseCustomFieldValue('SELECT', ['a']));
        expect(parseCustomFieldValue('MULTI_SELECT', ['a', 'b', 'a'])).toEqual({ kind: 'options', optionIds: ['a', 'b'] });
        expect(parseCustomFieldValue('MULTI_SELECT', [])).toEqual({ kind: 'clear' });
        refused(() => parseCustomFieldValue('MULTI_SELECT', 'a'));
        refused(() => parseCustomFieldValue('MULTI_SELECT', ['ok', 'not ok!']));
        expect(parseCustomFieldValue('PERSON', 'u-1')).toEqual({ kind: 'person', userId: 'u-1' });
        refused(() => parseCustomFieldValue('PERSON', 42));
    });
});

describe('parseCustomFieldCondition', () => {
    it('takes only the operators of the type', () => {
        for (const t of CUSTOM_FIELD_TYPES) {
            for (const op of ['empty', 'set', 'any', 'is', 'eq', 'contains', 'gt', 'before'] as const) {
                const allowed = (CUSTOM_FIELD_TYPE_SPECS[t].operators as readonly string[]).includes(op);
                if (!allowed) refused(() => parseCustomFieldCondition(t, `${op}:x`, 'me-id'));
            }
        }
    });

    it('any: ids, the none token for empty, and me for a person filter', () => {
        expect(parseCustomFieldCondition('SELECT', 'any:a,b,none,a', 'u')).toEqual({ op: 'any', ids: ['a', 'b'], orEmpty: true });
        expect(parseCustomFieldCondition('PERSON', 'any:me', 'u-me')).toEqual({ op: 'any', ids: ['u-me'], orEmpty: false });
        refused(() => parseCustomFieldCondition('SELECT', 'any:', 'u'));
        refused(() => parseCustomFieldCondition('SELECT', 'any:bad id', 'u'));
    });

    it('typed operands are checked; presence takes none', () => {
        expect(parseCustomFieldCondition('NUMBER', 'gte:2.5', 'u')).toEqual({ op: 'gte', number: '2.5' });
        refused(() => parseCustomFieldCondition('NUMBER', 'gt:abc', 'u'));
        expect(parseCustomFieldCondition('DATE', 'onOrAfter:2031-01-01', 'u')).toEqual({ op: 'onOrAfter', date: '2031-01-01' });
        refused(() => parseCustomFieldCondition('DATE', 'before:tomorrow', 'u'));
        expect(parseCustomFieldCondition('TEXT', 'contains:a:b', 'u')).toEqual({ op: 'contains', text: 'a:b' });
        expect(parseCustomFieldCondition('CHECKBOX', 'is:false', 'u')).toEqual({ op: 'is', checked: false });
        refused(() => parseCustomFieldCondition('CHECKBOX', 'is:maybe', 'u'));
        expect(parseCustomFieldCondition('URL', 'empty', 'u')).toEqual({ op: 'empty' });
        refused(() => parseCustomFieldCondition('URL', 'empty:x', 'u'));
    });
});

describe('the client spelling of filters and sorts', () => {
    it('maps filter-system values to the list query', () => {
        expect(customFieldFilterParam('SELECT', ['a', 'none'])).toBe('any:a,none');
        expect(customFieldFilterParam('PERSON', ['u-1'])).toBe('any:u-1');
        expect(customFieldFilterParam('CHECKBOX', ['checked'])).toBe('is:true');
        expect(customFieldFilterParam('CHECKBOX', ['unchecked'])).toBe('is:false');
        expect(customFieldFilterParam('NUMBER', ['set'])).toBe('set');
        expect(customFieldFilterParam('DATE', ['empty'])).toBe('empty');
        expect(customFieldFilterParam('TEXT', [])).toBeUndefined();
    });

    it('reads field ids from filter keys and orders, refusing anything else', () => {
        expect(fieldIdOfFilterKey('cf.abc_1')).toBe('abc_1');
        expect(fieldIdOfFilterKey('priority')).toBeNull();
        expect(fieldIdOfFilterKey('cf.bad id')).toBeNull();
        expect(fieldIdOfOrder('cf:x1')).toBe('x1');
        expect(fieldIdOfOrder('due')).toBeNull();
    });
});
